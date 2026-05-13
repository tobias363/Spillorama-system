# Knowledge backup + restore — daglig immutable snapshots

**Status:** Autoritativ. Del av KNOWLEDGE_AUTONOMY_PROTOCOL.
**Etablert:** 2026-05-13
**Eier:** Tobias Haugen + PM-AI

---

## 0. Hvorfor dette eksisterer

Spillorama-pilot har 5 kjerne-kunnskaps-artefakter som er fundament for
hele autonomy-systemet:

| # | Fil | Hva |
|---|---|---|
| 1 | `docs/engineering/FRAGILITY_LOG.md` | Kode som ALDRI skal røres uten verifisering |
| 2 | `docs/engineering/PITFALLS_LOG.md` | Fallgruver per domene |
| 3 | `docs/engineering/AGENT_EXECUTION_LOG.md` | Kronologisk agent-arbeid + learnings |
| 4 | `docs/engineering/KNOWLEDGE_AUTONOMY_PROTOCOL.md` | Selv-forbedrende-kunnskaps-protokoll |
| 5 | `tests/e2e/BUG_CATALOG.md` | E2E-bugs spores |
| + | `.claude/skills/**/SKILL.md` | Distribuert domene-kunnskap |

Hvis en agent uforvarende **overskriver, tømmer eller korrumperer** en av
disse filene — for eksempel ved feilkonfigurert search-and-replace, eller
ved at en automatisert generator skriver feil format — vil hele
autonomy-systemet miste tillit.

Git har full historikk, men:
- **Å finne riktig SHA krever git-erfaring** (sub-optimal for ny PM).
- **Å plukke ut riktig fil-versjon** krever `git show <sha>:<path>` som
  ikke alle husker.
- **Det er ikke en daglig avtalt sjekkpunkt** — å vite "alt var ok i
  går 02:00 UTC" er mer presist enn å lete gjennom commits.

Daglige tags `knowledge/YYYY-MM-DD` gir oss et **datert, immutable, lett
gjenfinnbart** referansepunkt.

---

## 1. Daglig snapshot — slik fungerer det

### Hva
[.github/workflows/knowledge-backup-daily.yml](../../.github/workflows/knowledge-backup-daily.yml)
kjører hver dag kl **02:00 UTC** (~03:00/04:00 Europe/Oslo) og:

1. Sjekker ut `main` med full historie.
2. Verifiserer at alle 5 kunnskaps-filer + minst 1 SKILL.md eksisterer.
   Hvis noe mangler → workflow feiler (vi vil vite om noe er slettet).
3. Oppretter annotated git-tag `knowledge/YYYY-MM-DD` (UTC-dato) som
   peker på current main HEAD.
4. Pusher tag til origin.
5. Idempotent — hvis dagens tag allerede eksisterer (eks. workflow
   trigget manuelt tidligere samme dag), skipper den uten å feile.

### Tag-format

```
knowledge/2026-05-13
knowledge/2026-05-14
knowledge/2026-05-15
...
```

Datoen er ISO 8601 i UTC. Selv om Tobias er i Europe/Oslo med DST blir
tagen fortsatt opprettet rundt 04:00 lokal-tid.

### Idempotens

Hvis workflow kjøres flere ganger samme UTC-dag (eks. manuelt via
`workflow_dispatch`), opprettes tagen kun første gang. Andre kjøringer
logger "Tag exists — skipping" og avsluttes med 0.

### Manuell trigger

```bash
gh workflow run knowledge-backup-daily.yml
```

Eller via GitHub Actions UI → Actions → "Knowledge backup daily" → "Run
workflow".

---

## 2. Liste alle snapshots

```bash
bash scripts/list-knowledge-snapshots.sh
```

Eksempel-output:

```
TAG                          SHA       MELDING
----                         ---       -------
knowledge/2026-05-13         abc1234   Knowledge snapshot knowledge/2026-05-13
knowledge/2026-05-12         def5678   Knowledge snapshot knowledge/2026-05-12
knowledge/2026-05-11         9876543   Knowledge snapshot knowledge/2026-05-11

Total: 3 snapshots.
```

Vis kun siste N:
```bash
bash scripts/list-knowledge-snapshots.sh --last 7
```

---

## 3. Restore fra snapshot

### Når bruke

1. **Akutt korrupsjon** — agent har skrevet ugyldig markdown,
   overskrevet halve FRAGILITY_LOG, etc.
2. **Tilbakerulling av endring** — vi gjorde en ADR-revert og vil
   tilbake til pre-ADR-state for kunnskaps-artefakter.
3. **Disaster recovery** — disk-failure, repo-korrupsjon, etc.

### Slik gjør du det

```bash
bash scripts/restore-knowledge.sh \
  --tag knowledge/2026-05-12 \
  --reason "FRAGILITY_LOG ble overskrevet av buggy generator i PR #1234"
```

Scriptet:
1. Henter tags fra origin.
2. Verifiserer at tagen finnes.
3. Viser diff-stat mellom current HEAD og tag.
4. **Spør om bekreftelse** (`yes`/`no`).
5. Kjører `git checkout <tag> -- <files>` for å hente fil-innhold.
6. Stager filene.
7. Lager ÉN commit med Conventional Commits-format:
   ```
   chore(knowledge): restore from knowledge/2026-05-12 — <reason>
   ```
8. Skriver guide for neste steg (push + AGENT_EXECUTION_LOG-entry).

### Unattended (CI / scripts)

```bash
bash scripts/restore-knowledge.sh \
  --tag knowledge/2026-05-12 \
  --reason "Automated rollback after corruption detected" \
  --yes
```

`--yes` skipper interaktiv bekreftelse. **Bruk forsiktig.** Foretrukket
flow er at PM/Tobias eksplisitt godkjenner restore.

### `--reason` er obligatorisk

Du kan ikke restorere uten å oppgi en grunn. Grunnen havner i
commit-meldingen og audit-trail. Dette tvinger oss til å dokumentere
hvorfor vi rullet tilbake, slik at neste PM kan forstå hva som skjedde.

---

## 4. Audit-trail

Hver restore MÅ følges opp med entry i
[`docs/engineering/AGENT_EXECUTION_LOG.md`](./AGENT_EXECUTION_LOG.md):

```markdown
### YYYY-MM-DD HH:MM — knowledge-restore (PM-AI)

**Scope:** Restore knowledge artefakter fra knowledge/<dato>.

**Inputs:**
- Tag: knowledge/<dato>
- Reason: <eksakt reason fra commit-message>

**Outputs:**
- Branch: <branch-navn>
- Commit: <SHA> — `chore(knowledge): restore from <tag> — <reason>`
- Restorerte filer: liste

**Fallgruver oppdaget:**
- Hvilken agent / PR forårsaket korrupsjonen?
- Var det en gap i pre-commit hooks vi kan tette?

**Læring:**
- Hva burde vi gjort annerledes for å unngå dette?
- Bør vi legge til en ny validering i pre-commit eller CI?

**Verifisering (PM):**
- Kjørte `git diff HEAD~1 HEAD -- <files>` for å bekrefte korrekt restore.
- Verifiserte at scripts/check-pm-gate.mjs fortsatt passerer.

**Tid:** ~15 min
```

---

## 5. Hvorfor immutable tags?

### Branch-protection note (ikke-håndhevet via CI)

`knowledge/*`-tags representerer **immutable historikk**. De skal:

- **ALDRI force-pushes** (`git push --force origin knowledge/...`)
- **ALDRI slettes** (`git push --delete origin knowledge/...`)
- **ALDRI flyttes** til en annen commit

Det finnes ikke (per 2026-05-13) en GitHub Actions-måte å automatisk
blokkere disse operasjonene på tag-nivå. Vi stoler på disiplinen til
PM/agenter.

Hvis du **må** flytte en tag (eks. tagen ble opprettet på feil SHA pga
en CI-bug), så:

1. Diskuter med Tobias.
2. Lag ny tag med ny dato-form, eks. `knowledge/2026-05-13-corrected`.
3. **Aldri** force-push den originale tagen.

### Hva med disk-plass?

Lightweight tags er ~50 bytes. Annotated tags er ~500 bytes. Med 365
tags per år bruker vi maks ~180 KB i året. Ingen praktisk grense.

---

## 6. Sammenheng med andre kunnskaps-systemer

Knowledge backup er **passiv** — den oppretter snapshots, men endrer
ikke noe. Det er kompletterende med:

| System | Hva | Hvor |
|---|---|---|
| Pre-commit FRAGILITY-check | Blokkerer commit hvis FRAGILITY-fil endret uten verifisering | `.husky/pre-commit` |
| Delta-report gate | Blokkerer PR uten delta-rapport | `.github/workflows/delta-report-gate.yml` |
| Context-pack generator | Auto-brief til agent ved spawn | `scripts/generate-context-pack.sh` |
| Live-monitor + ConsoleBridge | Runtime-observability | `scripts/pilot-monitor-enhanced.sh` |
| **Knowledge backup** (denne) | Daglig immutable snapshot for rollback | `.github/workflows/knowledge-backup-daily.yml` |

Hvis ÉN av disse svikter, har vi fortsatt de andre. Backup er sikkerhetsnett
"i tilfelle alle andre forsvar feiler".

---

## 7. Troubleshooting

### "Tag finnes ikke" når jeg prøver å restorere

```
ERROR: Tag 'knowledge/2026-05-12' finnes ikke.
```

Kjør `bash scripts/list-knowledge-snapshots.sh` og se hvilke tags som
faktisk finnes. Hvis tagen mangler, kan det være fordi:
- Workflow ikke har kjørt ennå (sjekk Actions-tab på GitHub).
- Workflow feilet pga manglende fil (sjekk Actions-loggen).
- Du har ikke fetchet tags lokalt — scriptet kjører `git fetch
  origin --tags` automatisk, men hvis du er offline funker ikke det.

### Restore lager ingen commit

```
Ingen forskjell mellom current HEAD og knowledge/2026-05-12 — ingen
commit opprettet.
```

Dette er forventet hvis filene allerede er identiske med snapshot-en.
Restore er da en no-op.

### Workflow feiler med "Missing required knowledge file"

En av de 5 kjerne-filene er slettet eller ikke pushet til main. Dette
betyr at noen har gjort noe fundamentalt feil. Sjekk siste commits til
`main` og rull tilbake.

### Kan jeg restorere ENKELT-fil i stedet for hele settet?

Ikke direkte fra scriptet — det er bygget for at alle 5+ filer
restorerers atomisk for å unngå inkonsistens. Hvis du virkelig trenger
det:

```bash
git fetch origin --tags
git checkout knowledge/2026-05-12 -- docs/engineering/FRAGILITY_LOG.md
git add docs/engineering/FRAGILITY_LOG.md
git commit -m "chore(knowledge): partial restore FRAGILITY_LOG.md from knowledge/2026-05-12

Reason: <text>"
```

---

## 8. Endringslogg

| Dato | Endring | Forfatter |
|---|---|---|
| 2026-05-13 | Initial — workflow, restore-script, list-script, denne docen. | Knowledge-backup-agent (feat/knowledge-backup-daily-2026-05-13) |

---

## 9. Relaterte dokumenter

- [`KNOWLEDGE_AUTONOMY_PROTOCOL.md`](./KNOWLEDGE_AUTONOMY_PROTOCOL.md) — de 7 pilarene
- [`FRAGILITY_LOG.md`](./FRAGILITY_LOG.md) — fragility-katalog
- [`PITFALLS_LOG.md`](./PITFALLS_LOG.md) — fallgruve-katalog
- [`AGENT_EXECUTION_LOG.md`](./AGENT_EXECUTION_LOG.md) — agent-historikk
- [`../../tests/e2e/BUG_CATALOG.md`](../../tests/e2e/BUG_CATALOG.md) — bug-katalog
- [`../../.github/workflows/knowledge-backup-daily.yml`](../../.github/workflows/knowledge-backup-daily.yml) — workflow
- [`../../scripts/restore-knowledge.sh`](../../scripts/restore-knowledge.sh) — restore-script
- [`../../scripts/list-knowledge-snapshots.sh`](../../scripts/list-knowledge-snapshots.sh) — list-script
