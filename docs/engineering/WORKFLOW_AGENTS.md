# Agent-arbeidsflyt — slot-baserte worktrees

> **Formål:** Forhindre at flere agenter tråkker på hverandre i samme mappe og at arbeid blir borte. Én agent = én slot = én branch = én worktree. Alltid.

## De tre slottene

Repoet har **tre permanente "slots"** — faste worktrees på faste branches:

| Slot | Branch | Worktree-sti |
|------|--------|--------------|
| 1 | `agent/slot-1` | `.claude/worktrees/slot-1` |
| 2 | `agent/slot-2` | `.claude/worktrees/slot-2` |
| 3 | `agent/slot-3` | `.claude/worktrees/slot-3` |

Hver slot er en helt isolert arbeidskopi av repoet. Filendringer i slot-1 er usynlige for slot-2 og slot-3 helt til de merges via `main`.

## Delegering til en agent

Når du starter en ny agent, si én av disse fire tingene eksplisitt:

1. **"Bruk slot-1"** — agent jobber i `.claude/worktrees/slot-1/` på `agent/slot-1`.
2. **"Bruk slot-2"** — tilsvarende.
3. **"Bruk slot-3"** — tilsvarende.
4. **"Lag ny worktree"** — for engangsjobber eller hvis alle slots er opptatt; agent lager sin egen `.claude/worktrees/<name>/` og tilhørende `claude/<name>` branch.

**Ikke start en agent uten å spesifisere slot eller worktree.** Uten eksplisitt slot ender agenten i hovedmappa og risikerer kollisjon.

### Sjekk at en slot er ledig før delegering

```bash
cd /Users/tobiashaugen/Projects/Spillorama-system
git -C .claude/worktrees/slot-1 status --short    # tom = ledig
git -C .claude/worktrees/slot-1 log --oneline main..HEAD    # tom = ren, klar for reset
```

Hvis slot-en har ukommitert eller ukjent arbeid, ikke delegér til den før du har merget eller forkastet innholdet.

## Regler for agenten

Alle tre slots følger samme regler:

1. **Commit ofte, lokalt er nok.** Hver logisk enhet — test, fix, refactor — får sin egen commit. Gir granulær `git revert` hvis noe går galt.
2. **Push branch til `origin` før du bytter task.** Worktree-mappa er lokal. Crasher disken eller stenger agenten uten push, er jobben borte. Push = sikkerhetskopi, ikke deploy.
3. **Merge til `main` bare etter verifisering.** Kjør `npm run check:all` (type-check + build + compliance). Grønn gate → merge. Rød gate → fiks på branch.
4. **En slot eier ikke sin branch.** Etter merge resettes sloten tilbake til `main` (se nedenfor). Branchnavnet `agent/slot-1` er bare en beholder.

## Livssyklus — start og avslutt en task

### Start (agent plukker opp slot-1)

```bash
cd /Users/tobiashaugen/Projects/Spillorama-system/.claude/worktrees/slot-1
git fetch origin
git reset --hard origin/main       # kun hvis sloten er ren; ellers advarsel
# ... agent jobber, committer, pusher ...
git push -u origin agent/slot-1
```

### Ferdig (task verifisert, skal merges)

```bash
# I hovedmappa (eller hvilken som helst worktree)
cd /Users/tobiashaugen/Projects/Spillorama-system
git checkout main
git pull origin main
git merge --no-ff agent/slot-1 -m "merge: <task-beskrivelse>"
git push origin main

# Reset sloten for neste bruk
cd .claude/worktrees/slot-1
git fetch origin
git reset --hard origin/main
git push -f origin agent/slot-1    # overskriv remote slot-branch med main
```

`--no-ff` beholder merge-commit-en som historisk markør for at en slot ble merget inn.

`push -f` på en slot-branch er trygt fordi slotten *eies ikke* — innholdet er allerede bevart på `main`.

## Hva hovedmappa er for

`/Users/tobiashaugen/Projects/Spillorama-system/` (sjekket ut på `main`) er **ikke** en arbeidskopi for agenter. Den er for:

- `git pull` for å synke main
- `git log`, `git diff main...agent/slot-N` for å se hva slots planlegger å merge
- `git worktree list` for å se hvilke slots som er aktive
- Manuell opprydning av `.meta`-filer, untracked assets etc. som ikke hører i en branch

**Aldri** la en agent jobbe direkte i hovedmappa.

## Hvorfor dette virker

- **Ingen fildelings-race.** Hver slot har sin egen `node_modules`, `dist/`, `.env.production`. Parallell `npm install` i slot-1 og slot-2 gjør ingenting med hverandre.
- **Delt `.git`.** Alle worktrees refererer samme objekt-database. Raskt å opprette, billig i disk (kun arbeidstrær, ikke duplisert historikk).
- **Eksplisitt adressering.** Du sier "bruk slot-2" til agenten, og den vet nøyaktig hvor den skal. Ingen gjetting, ingen overlapp.
- **Safety net via push.** Selv om slot-1 sin worktree slettes, ligger arbeidet trygt på `origin/agent/slot-1` så lenge agenten har pushet.

## Sjekkliste før du delegerer

- [ ] Valgt slot (1/2/3) eller bedt agenten lage ny worktree
- [ ] Sjekket at slotten er ren (`git status` tom, `git log main..HEAD` tom)
- [ ] Gitt agenten klar task-beskrivelse
- [ ] Bedt agenten pushe branchen ved slutten

## Sjekkliste før du merger

- [ ] `npm run check:all` grønn
- [ ] Compliance-suite grønn
- [ ] Manuell røyktest hvis UI/gameplay ble endret
- [ ] Merge med `--no-ff`, push `main`, reset slot til `main`
