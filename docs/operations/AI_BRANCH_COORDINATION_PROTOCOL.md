# AI Branch Coordination Protocol — Codex + Claude

**Status:** Autoritativ fra 2026-05-16. Oppdatert 2026-05-17 med mandatory fresh-main sync.
**Formål:** Hindre at Codex- og Claude-sesjoner skaper git-konflikter, kunnskapsdrift eller dobbeltdokumentasjon når begge jobber i samme repo.
**Gjelder:** Alle PM-er, Codex-sesjoner, Claude-sesjoner og agenter som skriver til `Spillorama-system`.
**Kort operativ rutine:** [`CODEX_CLAUDE_WORKTREE_ROUTINE.md`](./CODEX_CLAUDE_WORKTREE_ROUTINE.md) er den praktiske start-/rebase-/PR-body-rutinen for hver session.

---

## 1. Kjerneprinsipp

Codex og Claude kan jobbe parallelt, men de skal jobbe i adskilte spor:

| Spor | Branch-prefix | Primært ansvar |
|---|---|---|
| Codex | `codex/<scope>-YYYY-MM-DD` | Runtime-fiks, backend/frontend, live-test, DB, observability, Sentry/PostHog, CI-verifisering |
| Claude | `claude/<scope>-YYYY-MM-DD` | PM-struktur, kunnskapsflyt, playbooks, skills, handoff, governance, agent-kontrakter |

Begge kan lese alt. Bare én skal skrive til samme lock-fil om gangen.

**Fresh-main invariant:** Ingen Codex- eller Claude-session skal starte kodearbeid, fortsette på en gammel branch, eller røre lock-listen uten først å kjøre `git fetch origin` og rebase/merge mot fersk `origin/main`. Dette gjelder også når den andre AI-en nettopp har merget en PR.

---

## 2. Shared-file lock list

Disse filene skaper høy konflikt- og kunnskapsdrift-risiko. Ikke la Codex og Claude endre dem samtidig uten eksplisitt rebase/avklaring:

```text
docs/engineering/PITFALLS_LOG.md
docs/engineering/AGENT_EXECUTION_LOG.md
.claude/skills/pm-orchestration-pattern/SKILL.md
.github/workflows/**
package.json
package-lock.json
docs/auto-generated/SKILL_FILE_MAP.md
```

Regel: én aktiv branch eier lock-filen om gangen.

Hvis begge må endre samme lock-fil, gjelder denne rekkefølgen:

1. Første branch merges eller blir eksplisitt parkert.
2. Andre branch kjører:

   ```bash
   git fetch origin main
   git rebase origin/main
   ```

3. Konflikter løses append-only der det er logg/dokumentasjon.
4. Nummerering i `PITFALLS_LOG.md` justeres etter rebase, ikke før.
5. `SKILL_FILE_MAP.md` regenereres fra ren main-basert checkout hvis skills/scopes er endret.

---

## 3. Session-start preflight

Før første filendring i en ny Codex- eller Claude-session:

Codex:

```bash
cd /Users/tobiashaugen/Projects/Spillorama-system-codex
npm run agent:preflight -- --actor codex
```

Claude:

```bash
cd /Users/tobiashaugen/Projects/Spillorama-system-claude
npm run agent:preflight -- --actor claude
```

Ikke rediger filer før scriptet skriver `PREFLIGHT PASS`.

Hvis du starter ny branch fra main-worktree:

```bash
git switch main
git pull --ff-only origin main
git switch -c codex/<scope>-YYYY-MM-DD   # eller claude/<scope>-YYYY-MM-DD
```

Hvis du allerede står på en feature-branch eller i egen worktree:

```bash
git fetch origin main --prune
git status -sb
git rebase origin/main
```

Hvis branchen allerede er pushet, push kun etter vellykket rebase med:

```bash
git push --force-with-lease
```

`git merge origin/main` er kun akseptabelt hvis branchen er delt mellom flere aktører og SHA-rewrite vil skjule andres arbeid. Da må PR-body forklare hvorfor merge ble valgt i stedet for rebase.

PM/session-agent skal deretter skrive i sin interne plan eller første status:

```text
Branch lane: codex|claude
Planned branch: <branch>
Base: origin/main@<short-sha>
Fresh-main sync: fetched + rebased|merged|created-from-origin-main
Shared-file intent: none | <fil-liste>
Open PRs checked: yes
Rebase needed before shared files: yes|no
```

Hvis `Shared-file intent` overlapper med en åpen PR fra det andre sporet, stopp og avklar owner før filendring.

---

## 4. PR-body krav

Alle PR-er som rører lock-listen skal ha disse linjene i PR-body:

```markdown
Fresh-main sync: fetched origin/main and rebased|merged at <short-sha>
Shared-file rebase: origin/main@<short-sha>
Shared files touched:
- <path>
Coordination note: <hvem eier overlapp / hvorfor ingen overlapp>
```

Hvis PR-en ikke rører lock-listen:

```markdown
Shared files touched: none
```

Dette gjør det mulig for neste PM å se om PR-en var koordinert uten å lese hele diffen først.

---

## 5. Append-only regler for kunnskapsloggene

`PITFALLS_LOG.md` og `AGENT_EXECUTION_LOG.md` er append-only i praksis.

Tillatt:

- Legge til ny entry.
- Renummerere egen nye entry etter rebase.
- Legge til PR-/commit-referanse i egen nye entry.

Ikke tillatt uten eksplisitt Tobias/PM-beslutning:

- Slette gamle entries.
- Rewrite gamle læringspunkter.
- Slå sammen to historiske entries for å "rydde".
- Endre tidligere agenters konklusjoner uten ny correction-entry.

Hvis noe gammelt er feil, legg til en ny correction-entry som peker til den gamle.

---

## 6. Workflow- og package-regel

`.github/workflows/**`, `package.json` og `package-lock.json` har høy blast-radius.

Regel:

- Én branch eier workflow/package-endringer om gangen.
- Den andre sessionen skal ikke "bare legge til en liten script-endring" i samme periode.
- Etter merge må andre branch rebase før den endrer workflows/package igjen.

Unntak: P0/P1 incident. Da gjelder `INCIDENT_MODE_VS_KNOWLEDGE_PROTOCOL.md`, men incident-PR-en må dokumentere hvorfor lock-regelen ble brutt.

---

## 7. Claude prompt — copy/paste

Bruk denne teksten når Claude skal fortsette parallelt med Codex:

```text
Du jobber i Spillorama-system parallelt med Codex. Følg docs/operations/AI_BRANCH_COORDINATION_PROTOCOL.md før første filendring.

Din branch-lane er claude/<scope>-YYYY-MM-DD. Codex bruker codex/<scope>-YYYY-MM-DD. Start alltid med:

cd /Users/tobiashaugen/Projects/Spillorama-system-claude
npm run agent:preflight -- --actor claude

Ikke endre filer før scriptet skriver PREFLIGHT PASS.

Før du endrer filer, rapporter:
- Branch lane
- Planned branch
- Base origin/main@<short-sha>
- Fresh-main sync: fetched + rebased|created-from-origin-main
- Shared-file intent
- Om du må rebase før lock-files

IKKE endre disse samtidig som Codex uten eksplisitt avklaring og rebase:
- docs/engineering/PITFALLS_LOG.md
- docs/engineering/AGENT_EXECUTION_LOG.md
- .claude/skills/pm-orchestration-pattern/SKILL.md
- .github/workflows/**
- package.json
- package-lock.json
- docs/auto-generated/SKILL_FILE_MAP.md

Hvis du må endre en av disse: sjekk åpne PR-er først. Hvis Codex allerede har en PR som rører samme fil, vent til den er merget eller rebase på origin/main etter den. For PITFALLS_LOG og AGENT_EXECUTION_LOG skal du kun gjøre append-only endringer og renummerere egne nye entries etter rebase.

Alle PR-er som rører lock-listen skal ha i PR-body:
Fresh-main sync: fetched origin/main and rebased|merged at <short-sha>
Shared-file rebase: origin/main@<short-sha>
Shared files touched:
- <path>
Coordination note: <hvem eier overlapp / hvorfor ingen overlapp>

Hvis PR-en ikke rører lock-listen:
Shared files touched: none

Du skal ikke merge selv hvis det finnes overlappende Codex-branch. Be PM/Codex om rebase/merge-rekkefølge.
```

---

## 8. Codex prompt — copy/paste

Bruk denne teksten når Codex starter ny session mens Claude jobber parallelt:

```text
Du jobber i Spillorama-system parallelt med Claude. Følg docs/operations/AI_BRANCH_COORDINATION_PROTOCOL.md før første filendring.

Din branch-lane er codex/<scope>-YYYY-MM-DD. Claude bruker claude/<scope>-YYYY-MM-DD. Start alltid med:

cd /Users/tobiashaugen/Projects/Spillorama-system-codex
npm run agent:preflight -- --actor codex

Ikke endre filer før scriptet skriver PREFLIGHT PASS.

Før du endrer filer, rapporter branch lane, planned branch, base origin/main@<short-sha>, fresh-main sync, shared-file intent, og om rebase trengs.

Ikke endre lock-listen samtidig som Claude:
- docs/engineering/PITFALLS_LOG.md
- docs/engineering/AGENT_EXECUTION_LOG.md
- .claude/skills/pm-orchestration-pattern/SKILL.md
- .github/workflows/**
- package.json
- package-lock.json
- docs/auto-generated/SKILL_FILE_MAP.md

Hvis runtime-fiksen krever skill/PITFALLS/AGENT_EXECUTION_LOG, gjør det i samme PR bare hvis ingen Claude-PR eier filene. Hvis Claude eier dem, avklar rekkefølge: merge/rebase først, deretter append-only update.
```

---

## 9. Eksempel

2026-05-16:

- Codex runtime branch: `codex/spill1-goh-observability-2026-05-16`
- Claude knowledge branch: `claude/<knowledge-scope>-2026-05-16`
- Overlapp-risiko: `PITFALLS_LOG.md`, `AGENT_EXECUTION_LOG.md`, `pm-orchestration-pattern`, workflows, package-filer.
- Valgt løsning: Codex fikk egen runtime PR. Claude kan fortsette på egen branch, men må rebase etter Codex-merge før lock-listen røres igjen.

---

## 10. Anti-patterns

| Ikke gjør dette | Gjør dette |
|---|---|
| Codex og Claude endrer `PITFALLS_LOG.md` samtidig | Én eier, andre rebases etter merge |
| Fortsette på branch etter at den andre AI-en har merget | `git fetch origin main --prune` + `git rebase origin/main` før ny filendring |
| "Bare en liten workflow-endring" i begge branches | Én workflow-owner om gangen |
| Renummerere PITFALLS før rebase | Rebase først, renummerer egne nye entries etterpå |
| Merge docs-branch uten å sjekke runtime-PR | `gh pr list` først |
| Oppdatere `SKILL_FILE_MAP.md` fra dirty worktree | Regenerer fra ren main-basert checkout |
| Slette gamle knowledge entries | Legg til correction-entry |

---

## 11. Relaterte dokumenter

- [`CODEX_CLAUDE_WORKTREE_ROUTINE.md`](./CODEX_CLAUDE_WORKTREE_ROUTINE.md)
- [`PM_SESSION_START_CHECKLIST.md`](./PM_SESSION_START_CHECKLIST.md)
- [`INCIDENT_MODE_VS_KNOWLEDGE_PROTOCOL.md`](./INCIDENT_MODE_VS_KNOWLEDGE_PROTOCOL.md)
- [`../engineering/ENGINEERING_WORKFLOW.md`](../engineering/ENGINEERING_WORKFLOW.md)
- [`../engineering/WORKFLOW_AGENTS.md`](../engineering/WORKFLOW_AGENTS.md)
- [`../engineering/AGENT_DELIVERY_REPORT_TEMPLATE.md`](../engineering/AGENT_DELIVERY_REPORT_TEMPLATE.md)

---

## Endringslogg

| Dato | Endring |
|---|---|
| 2026-05-16 | Initial — etablert etter Codex/Claude parallellarbeid og konflikt-risiko rundt knowledge logs, workflows og package-filer. |
| 2026-05-17 | La til mandatory fresh-main sync: alle Codex/Claude-branches skal `git fetch origin` + rebase/merge mot `origin/main` før første filendring og etter at den andre AI-en har merget. PR-body må dokumentere sync for lock-list PR-er. |
| 2026-05-17 | La til peker til `CODEX_CLAUDE_WORKTREE_ROUTINE.md` som konkret worktree-rutine for Codex/Claude-lanes. |
