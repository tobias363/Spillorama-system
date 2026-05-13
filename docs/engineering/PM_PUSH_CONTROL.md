# PM Push Control — kontroll over multi-agent git-pushes

**Status:** Phase 2 aktivt (utvidet 2026-05-13)
**Eier:** PM-AI (per ADR-0009 — PM eier git)
**Etablert etter Tobias-direktiv 2026-05-13:** *"Kan du også sette opp rutine i at du har kontroll på alt som blir pusha til git så du kan forsikre om at det ikke blir konfliktende arbeid"*

---

## Hvorfor

Med 5-10+ parallelle agenter under aktiv pilot-utvikling oppstår merge-konflikter raskt. Verktøyet `scripts/pm-push-control.mjs` gir PM (meg):

1. **Synlighet** — alle aktive agenter + deres deklarerte scope ved hvert tidspunkt
2. **Konfliktdeteksjon** — fil-overlapp FØR PR åpnes, ikke etter
3. **Merge-ordre-anbefaling** — topologisk sortering av åpne PR-er
4. **Aktiv push-overvåkning** — daemon som detekterer nye pushes
5. **Pre-push scope-håndhevelse** (Phase 2) — git-hook som sjekker mot deklarert scope
6. **Auto-rebase ved PR-merge** (Phase 2) — workflow som rebaser overlappende PR-er
7. **HTML-dashboard** (Phase 2) — visuell oversikt med auto-refresh
8. **Mac-notif integrasjon** (Phase 2) — severity-baserte system-varsler
9. **Live-monitor-korrelasjon** (Phase 2) — kobler P0/P1-events til aktive agent-scope

---

## Bruk (basiskommandoer)

### Daglig flyt

```bash
# Når jeg spawner ny agent — registrer scope FØRST
node scripts/pm-push-control.mjs register \
  <agent-id> \
  <branch-name> \
  <fil-glob-1> <fil-glob-2> ...

# Se hva som er aktivt nå
node scripts/pm-push-control.mjs list

# Sjekk konflikter (in-flight + åpne PR-er)
node scripts/pm-push-control.mjs conflicts

# Få anbefalt merge-rekkefølge for åpne PR-er
node scripts/pm-push-control.mjs merge-order

# Sammenlign agentens DEKLARERTE scope mot ACTUAL diff
node scripts/pm-push-control.mjs diff <agent-id-or-shortname>

# Når agent leverer + jeg har laget PR
node scripts/pm-push-control.mjs unregister <agent-id-or-shortname>

# Daemon-modus (poll hvert 30s, varsler på nye pushes via Mac-notif)
node scripts/pm-push-control.mjs watch
```

### Phase 2-kommandoer

```bash
# Sjekk om en push fra branch X stemmer overens med dens agent-scope
# (Brukes av pre-push-hook, men kan kjøres manuelt)
node scripts/pm-push-control.mjs scope-check <branch> [<file>...]

# Generér HTML-dashboard (auto-refresh 30s)
node scripts/pm-push-control.mjs dashboard
# Eller via wrapper-script (med browser-open og watch-modus):
bash scripts/generate-push-control-dashboard.sh --open --watch

# Send Mac-notif manuelt (severity-baserte lyder)
node scripts/pm-push-control.mjs notify P0 "Critical incident"
node scripts/pm-push-control.mjs notify P3 "Heads-up"

# Korreler live-monitor P0/P1-events med aktive agent-scope
node scripts/pm-push-control.mjs monitor-correlate
```

### Globale flags

```bash
--registry <path>       # Override registry-lokasjon (default: .claude/active-agents.json)
--silent                # Suppress non-essential output (for scripts og hooks)
```

Env-vars som override:

```bash
PM_PUSH_CONTROL_REGISTRY=<path>   # Equivalent to --registry
PM_PUSH_STRICT_SCOPE=1            # scope-check ABORTS push på out-of-scope
PM_PUSH_BYPASS=1                  # Skip alle pre-push-hooks
PM_PUSH_SCOPE_CHECK_BYPASS=1      # Skip kun scope-check (andre hooks kjører)
```

### Pre-spawn-sjekkliste (PM-rutine)

Før jeg spawner ny agent, sjekker jeg:

1. `node scripts/pm-push-control.mjs list` — hvilke agenter er aktive?
2. Skriv ned deklarert scope for ny agent
3. Verifiser at scope IKKE overlapper kritiske filer for andre aktive agenter
4. Hvis overlapp er uunngåelig (eks. AGENT_EXECUTION_LOG.md som ALLE skriver til), dokumenter i `conflictsAcknowledged` i registry
5. Spawn agent → `register` med deklarert scope

### Post-delivery-rutine

Når agent leverer:

1. `node scripts/pm-push-control.mjs diff <id>` — verifiser at faktisk diff matcher deklarert scope
2. Hvis betydelig avvik → flag for PR-review
3. `gh pr create + auto-merge`
4. `node scripts/pm-push-control.mjs unregister <id>`
5. Etter merge: `node scripts/pm-push-control.mjs merge-order` — gjenværende PR-er som kanskje trenger rebase
6. **Phase 2:** Auto-rebase-workflow (`.github/workflows/auto-rebase-on-merge.yml`) gjør dette automatisk og kommenterer på påvirkede PR-er

---

## Registry-format (Phase 2)

Persistent state ligger i **`.claude/active-agents.json`** (committed til repo, persisterer på tvers av PM-sesjoner og worktrees):

```json
{
  "version": 2,
  "updatedAt": "ISO-timestamp",
  "agents": [
    {
      "id": "agent-id",
      "shortname": "A1",
      "topic": "Kort beskrivelse",
      "branch": "feat/branch-name",
      "scope": ["fil-glob-1", "fil-glob-2"],
      "spawnedAt": "ISO-timestamp",
      "status": "in-flight"
    }
  ],
  "conflictsAcknowledged": [
    {
      "files": ["docs/engineering/AGENT_EXECUTION_LOG.md"],
      "agents": ["A1", "A2"],
      "type": "additive-append",
      "resolution": "auto-resolvable som append"
    }
  ]
}
```

### Migrering fra Phase 1 (/tmp/active-agents.json)

Phase 1 brukte `/tmp/active-agents.json` (ephemeral). Phase 2 migrerer automatisk:

1. Ved første `pm-push-control`-kall, sjekkes om `.claude/active-agents.json` finnes
2. Hvis ikke, men `/tmp/active-agents.json` finnes — content kopieres med `migratedFrom`-metadata
3. Etter migrering brukes alltid `.claude/active-agents.json`

Du trenger ingen manuell handling — migreringen er transparent.

### Registry-lokasjon-priority

1. `--registry <path>` CLI-flag (høyest)
2. `PM_PUSH_CONTROL_REGISTRY=<path>` env-var
3. `.claude/active-agents.json` (default)
4. Migrering fra `/tmp/active-agents.json` hvis #3 ikke finnes

Audit-trail i `/tmp/pm-push-control.log` (per-maskin, ikke committed).

---

## Pre-push git-hook (Phase 2)

`.husky/pre-push` fyrer automatisk når en agent kjører `git push`. Hook-en delegerer til `.husky/pre-push-agent-scope-check.sh`:

1. Leser branch-navnet som pushes
2. Slår opp branch i `.claude/active-agents.json`
3. Hvis branch ikke er registrert → passerer silent
4. Hvis branch er registrert:
   - Henter `git diff --name-only` mot `origin/main`
   - Sjekker hver fil mot agentens `scope`-globs
   - Hvis filer er utenfor scope:
     - **Default mode:** WARN i stderr (exit 0 — push allowed)
     - **Strict mode** (`PM_PUSH_STRICT_SCOPE=1`): ABORT (exit 1 — push blocked)
   - Sender Mac-notif P2 ved scope-creep

### Bypass

```bash
PM_PUSH_BYPASS=1 git push                       # Skip alle pre-push-hooks
PM_PUSH_SCOPE_CHECK_BYPASS=1 git push           # Skip kun scope-check
```

### Aktivering

Husky aktiverer hooken automatisk via `npm install`. Hvis hook ikke fyrer, kjør `npx husky` for å re-installere.

---

## Auto-rebase-workflow (Phase 2)

`.github/workflows/auto-rebase-on-merge.yml` fyrer ved hver `pull_request.closed` (merged=true):

1. Henter filer fra merget PR via `gh pr view`
2. Lister alle åpne PR-er
3. For hver åpen PR: sjekker fil-overlap med merget PR
4. For PR-er med overlap:
   - Kaller `PUT /repos/.../pulls/{number}/update-branch` (GitHub API)
   - Hvis rebase lyktes: kommenterer "Auto-rebased onto main"
   - Hvis rebase feilet (konflikter): kommenterer manuell-rebase-instruksjoner

Workflow krever:
- `permissions: contents: read, pull-requests: write` (allerede satt)
- Default `GITHUB_TOKEN` (auto-provisert av Actions)

### Begrensninger

- Auto-rebase virker KUN hvis rebase er konflikt-fri (GitHub-grensesnittet håndterer kun trivielle rebaser)
- Kompleks rebase krever manuell intervensjon (workflow kommenterer da)

---

## Mac-notif (Phase 2)

`pm-push-control.mjs notify <severity> <message>` bruker `osascript` på macOS:

| Severity | Lyd       | Bruk |
|----------|-----------|------|
| P0       | Sosumi    | Kritisk incident — krever umiddelbar handling |
| P1       | Submarine | Høy alvorlighet — agent korrelert med live-monitor-event |
| P2       | Pop       | Medium — scope-creep, manuell rebase trengs |
| P3       | Glass     | Info — ny PR, status-oppdatering |

På Linux/CI/non-macOS skipper notifen silent (returnerer `{ delivered: false, reason: "non-macOS platform" }`).

Auto-emissions:
- `poll` / `watch` — ny PR registrert → P3 (eller P1 hvis DIRTY/BLOCKED)
- `poll` / `watch` — konflikter detektert post-poll → P1
- `scope-check` — scope-creep → P2
- `monitor-correlate` — live-monitor event korrelert med agent → P1

---

## HTML-dashboard (Phase 2)

```bash
node scripts/pm-push-control.mjs dashboard
# eller:
bash scripts/generate-push-control-dashboard.sh --open --watch
```

Output: `/tmp/pm-push-control-dashboard.html`

Inneholder:
- Sammendrag (4 KPI-bokser: agents, open PRs, conflicts, dirty PRs)
- Aktive agenter (tabell med scope-count + spawn-time)
- Åpne PRs sortert etter merge-order (CLEAN-først)
- Konfliktmatrise (visuelt grupperte par)
- Siste 15 push-events (fra audit-loggen)
- Auto-refresh hvert 30. sek

Designet for å sitte i en pinned tab under aktiv multi-agent-sesjon.

---

## Live-monitor-integrasjon (Phase 2)

`pm-push-control.mjs monitor-correlate` leser `/tmp/pilot-monitor.log` (skrevet av B1's live-monitor-agent) og korrelerer P0/P1-events med aktive agent-scope:

1. Parser siste 200 log-linjer
2. Filtrerer på `P0` eller `P1` markører
3. Ekstraherer fil-stier via regex (`*.ts`, `*.tsx`, `*.mjs`, etc.)
4. For hver event: sjekker om fil-stiene matcher noen aktiv agent's scope
5. Hvis match: rapporterer korrelasjon + Mac-notif P1

Begrensning per 2026-05-13: avhenger av at B1's live-monitor er aktiv og skriver til `/tmp/pilot-monitor.log`. Hvis loggen mangler, rapporteres "design ready, no events yet".

PM-rutine:

```bash
# Hver 5-10 min når flere agenter er aktive:
node scripts/pm-push-control.mjs monitor-correlate
```

Forventet utvidelse når B1 lander: heuristikk for fil-ekstraksjon raffineres basert på faktisk monitor-output-format.

---

## Glob-syntaks (scope-deklarasjon)

- `*` — matcher hvilken som helst sekvens innenfor én sti-segment (matcher IKKE `/`)
- `**` — matcher rekursivt (matcher `/` også)
- `**/` — matcher null eller flere sti-segmenter (inkl. tom)
- Eksakte sti-strenger matcher seg selv

Eksempler:
```
apps/backend/src/game/Game1*           # matcher Game1Engine.ts, Game1LobbyService.ts
.claude/skills/*/SKILL.md              # matcher alle skills' SKILL.md
docs/engineering/PITFALLS_LOG.md       # eksakt fil
**/*.test.ts                           # alle test-filer rekursivt (inkl. root-nivå)
scripts/**/*.mjs                       # alle .mjs i scripts/ + undermapper
```

Globs implementert i `globMatch()` — testet i `scripts/__tests__/pm-push-control.test.mjs`.

---

## Konflikt-typer

| Type | Eksempel | Handling |
|---|---|---|
| **Hard kollisjon** | 2 agenter modifiserer samme funksjon i samme fil | Spawn én av dem først, vent på merge, så spawn andre |
| **Additiv-append** | Multiple agenter appender til AGENT_EXECUTION_LOG.md | Auto-mergeable hvis alle appender på slutten |
| **Additiv-section** | 2 agenter legger til hver sin nye seksjon i PITFALLS_LOG.md | Auto-merge oftest mulig (forskjellige steder) |
| **Konfigurasjon-merge** | 2 agenter legger til scripts i package.json | Manuell JSON-merge eller serielt |
| **Orkestrator-extend** | 2 agenter legger til hooks i `.husky/pre-commit` | Sekvensielt merge, andre rebases |

---

## Testing

```bash
# node:test (kjør med innebygd runner, ingen avhengigheter)
node --test scripts/__tests__/pm-push-control.test.mjs

# Bash-test for pre-push-hook
bash scripts/__tests__/pre-push-scope-check.test.sh

# YAML-validering av workflow
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/auto-rebase-on-merge.yml'))"
```

Status per 2026-05-13: **34 node:test + 9 bash-tester passerer**.

Vitest-kompatibilitet: Test-suiten bruker kun `node:test`-API som speiles av vitest, så `npx vitest run scripts/__tests__/pm-push-control.test.mjs` fungerer hvis vitest er installert (default i Spillorama: kun `node --test` via tsx, ingen vitest på root-level).

---

## Endringslogg

| Dato | Endring | Forfatter |
|---|---|---|
| 2026-05-13 | **Phase 1** — MVP. 11 aktive agenter registrert. List/register/conflicts/merge-order/diff/poll/watch commands. /tmp/active-agents.json registry. | PM-AI (Claude Opus 4.7) |
| 2026-05-13 | **Phase 2** — Persistent .claude/active-agents.json registry m/migrering. Pre-push hook (scope-check WARN/ABORT). Auto-rebase workflow. node:test suite (34 tests). Bash-test for hook (9 tests). Mac-notif severity-basert. HTML-dashboard m/auto-refresh. Live-monitor-korrelasjon. | Agent (Phase 2 build, PM-AI orkestrert) |

---

## Referanser

- ADR-0009 — PM-sentralisert git-flyt (Tobias 2026-04-21)
- `docs/engineering/AGENT_EXECUTION_LOG.md` — agent-aktivitet
- `docs/engineering/PITFALLS_LOG.md` §11 (agent-orkestrering)
- `scripts/pm-push-control.mjs` — kjernemodul
- `.husky/pre-push` + `.husky/pre-push-agent-scope-check.sh` — hooks
- `.github/workflows/auto-rebase-on-merge.yml` — workflow
- `scripts/__tests__/pm-push-control.test.mjs` — test-suite
- `scripts/__tests__/pre-push-scope-check.test.sh` — bash test
- `scripts/generate-push-control-dashboard.sh` — dashboard wrapper
