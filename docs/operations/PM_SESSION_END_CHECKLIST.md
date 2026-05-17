# PM Session END Checklist — eksakt prosedyre

**Status:** Autoritativ. Kjøres av AVSLUTTENDE PM ved hver sesjons-slutt.
**Tobias-direktiv 2026-05-14 IMMUTABLE:** "Hver PM tar over med samme kunnskapsnivå som den som avslutter."
**Eier:** Hver PM SKAL gå gjennom denne listen før sesjons-slutt.

---

## Hvorfor denne fila eksisterer

Forrige PM-rutine hadde implisitt "skriv PM_HANDOFF". Problemet: PM-er glemte deler, neste PM fikk hull i kontekst, fallgruver ble gjentatt. Tobias-direktiv 2026-05-14: vanntett rutine — eksakt hva avsluttende PM må gjøre.

---

## 9 obligatoriske trinn (i rekkefølge)

### Trinn 1 — Verifiser alle PR-er fra sesjonen er merget eller dokumentert

```bash
gh pr list --author "@me" --state all --search "created:>=$(date -v-1d +%Y-%m-%d)" --json number,title,state,mergedAt
```

For hver åpen PR: enten merge, dokumenter status i handoff, eller close med begrunnelse.

- [ ] Alle PR-er er enten merget eller har klart "venter på X"-status

### Trinn 2 — Skriv `PM_HANDOFF_<dato>.md`

Lokasjon: `docs/operations/PM_HANDOFF_YYYY-MM-DD.md` (eller `_session2/_PART2` hvis flere samme dag)

**Obligatoriske seksjoner:**
1. TL;DR for neste PM (3-5 setn)
2. Hva ble levert siste sesjon (PR-er + LOC + tests)
3. Hva gjenstår (åpne tasks med presis status)
4. Tobias-direktiver gitt under sesjonen (immutable)
5. State på sesjons-slutt (branches, backend, monitor)
6. Hvordan starte for nestemann (konkrete bash-kommandoer)
7. Telemetri fra sesjonen (PR-tall, bugs, tester, agenter)

**Mal:** Kopi siste PM_HANDOFF og tilpass. Hold under 600 linjer.

- [ ] PM_HANDOFF_<dato>.md skrevet og lagret

### Trinn 3 — Skriv `PM_SESSION_KNOWLEDGE_EXPORT_<dato>.md`

Lokasjon: `docs/operations/PM_SESSION_KNOWLEDGE_EXPORT_YYYY-MM-DD.md`

**Mal:** `docs/operations/PM_SESSION_KNOWLEDGE_EXPORT_TEMPLATE.md`

**7 obligatoriske seksjoner:**
1. Sesjons-mandat (Tobias' egne ord der mulig)
2. Kunnskap jeg tilegnet meg (mental models + Tobias-signaler + agent-erfaringer + live data)
3. Konkrete handlinger (filer lest + filer skrevet + PR-er + agenter)
4. Anti-mønstre jeg oppdaget under sesjonen
5. Open questions ved sesjons-slutt
6. Mental hand-off — 10 bullets "neste PM må vite"
7. Endringslogg (UTC-timestamps)

**Forskjell fra PM_HANDOFF:** Handoff fanger BESLUTNINGER. KNOWLEDGE_EXPORT fanger TACIT KNOWLEDGE — mental models, Tobias' kommunikasjons-signaler, agent-orkestrerings-erfaringer, live-data-funn, anti-mønstre PM selv oppdaget.

**SKRIV MENS KONTEKSTEN ER FERSK.** Ikke vent til neste dag. Skriv direkte etter at PR-er er merget.

- [ ] PM_SESSION_KNOWLEDGE_EXPORT_<dato>.md skrevet

### Trinn 4 — Update `PM_ONBOARDING_PLAYBOOK.md` hvis nye Tobias-direktiver kom

Hvis Tobias har gitt nye IMMUTABLE-direktiver under sesjonen:
- Legg til som ny seksjon i §2 "Tobias' fundamentale direktiver"
- Eller utvid eksisterende seksjon
- Marker med dato

- [ ] PM_ONBOARDING_PLAYBOOK oppdatert (eller eksplisitt vurdert som "ingen nye direktiver")

### Trinn 5 — Update `docs/engineering/PITFALLS_LOG.md` hvis nye fallgruver oppdaget

For HVER ny fallgruve PM eller agent oppdaget under sesjonen:
- Legg til entry under riktig § (1-12)
- Inkluder: Severity, Oppdaget, Symptom, Root cause, Fix, Prevention, Related
- Oppdater indeks-tabell + total count

- [ ] PITFALLS_LOG oppdatert (eller eksplisitt: "ingen nye fallgruver")

### Trinn 6 — Update `docs/engineering/AGENT_EXECUTION_LOG.md` hvis agenter brukt

For HVER agent spawnet under sesjonen:
- Entry øverst i "Entries (newest first)"
- Format: dato + agent-id (eller scope) + branch + leveranse + lessons learned

- [ ] AGENT_EXECUTION_LOG oppdatert med alle agent-leveranser

### Trinn 7 — Update relevante skills

Hvis sesjonen avdekket ny fagkunnskap som påvirker pågående eller fremtidige PR-er:
- Update relevant skill i `.claude/skills/<skill-name>/SKILL.md`
- Bump versjon i frontmatter (`metadata.version: vX.Y.Z`)
- Add endringslogg-entry med dato + hva som endret

Per Tobias-direktiv 2026-05-14 IMMUTABLE: PM oppdaterer skill IMMEDIATELY etter agent-leveranse (ikke "utsett til Trinn 2").

- [ ] Relevante skills oppdatert (eller eksplisitt: "ingen skills påvirket")

### Trinn 8 — Verifiser todos er rene

Bruk `TodoWrite` (eller manuelt):
- Alle `completed` → bra
- Alle `in_progress` eller `pending` → MÅ flyttes til PM_HANDOFF som "åpne tasks for neste PM"

- [ ] Ingen "hengende" todos uten dokumentasjon i handoff

### Trinn 9 — Run `bash scripts/pm-session-end.sh` (når den leveres)

Interaktiv runner som verifiserer Trinn 1-8 + signerer `.pm-session-end-confirmed.txt` med hash av filer du har skrevet. Confirmation-fil er bevis på passert sesjons-slutt-prosedyre.

- [ ] pm-session-end.sh passert (eller eksplisitt bypassed med dokumentert grunn)

### Trinn 10 — Local cleanup (anbefalt, ikke obligatorisk)

Fase B av ADR-0024 follow-up. Når sesjons-arbeid er merget og handoff er skrevet, kan PM rydde lokal worktree/stash-baggage akkumulert under sesjonen.

**DRY-RUN BY DEFAULT** — alle scripts viser hva de ville gjort før noe slettes:

```bash
# Worktrees: list med safety-verdict per item
bash scripts/cleanup-merged-worktrees.sh

# Stashes: kategoriser per pattern + alder
bash scripts/cleanup-stale-stashes.sh

# Branches: kategoriser per merge-status + open-PR + worktree-bruk
bash scripts/cleanup-merged-branches.sh            # lokale branches
bash scripts/cleanup-merged-branches.sh --remote   # remote branches på origin
bash scripts/cleanup-merged-branches.sh --all      # begge
```

Worktree-verdikter: `SAFE` (merget + ren), `LOCKED-S` (locked men ellers safe), `ORPHANED` (path borte, prune), `UNSAFE_*` (uncommittet/upushed/unmerged — beholdes), `CURRENT`, `MAIN` (kan ikke slettes).

Stash-kategorier: `AUTO-BACKUP` (lint-staged), `AGENT-LEFTOVER` (collision-baggage), `MERGED-BRANCH` (branch fjernet/merget), `FRESH` (≤ 7 dager, beholdes), `EXPLICIT-KEEP` (pre-rebase/recovery), `UNCLEAR` (manuell review).

Branch-kategorier: `MERGED` (ancestor av origin/main), `SQUASH-MERGED` (matcher merged-PR head), `FRESH` (< --min-age dager), `OPEN-PR` (har åpen PR — beholdes), `WORKTREE` (checked out — beholdes), `CURRENT`, `PROTECTED` (main/backup/recovery — aldri), `UNMERGED` (manuell vurdering).

For å faktisk slette:

```bash
# Interaktiv (Y/N per item)
bash scripts/cleanup-merged-worktrees.sh --apply
bash scripts/cleanup-stale-stashes.sh --apply
bash scripts/cleanup-merged-branches.sh --apply
bash scripts/cleanup-merged-branches.sh --apply --remote   # remote-cleanup

# Inkluder locked worktrees (eksplisitt flag)
bash scripts/cleanup-merged-worktrees.sh --apply --include-locked

# Eller bekreft alt på en gang (vær forsiktig)
bash scripts/cleanup-merged-worktrees.sh --apply --yes
bash scripts/cleanup-merged-branches.sh --apply --yes --all
```

Sikkerhet: UNSAFE/UNMERGED-verdikter slettes ALDRI. UNCLEAR-stashes (typisk squash-merget branch som ser "unmerged" lokalt) krever manuell vurdering — kjør `git stash show -p stash@{N}` for å sjekke innholdet før manuell `git stash drop`. Branch-script bruker `gh pr list --state merged` for å fange squash-merge-edge-case.

- [ ] (Valgfritt) Local cleanup utført, eller dokumentert hvorfor utsatt

---

## Anti-mønstre PM må unngå ved sesjons-slutt

| ❌ Aldri | ✅ I stedet |
|---|---|
| Skip session-knowledge-export "fordi jeg er sliten" | Skriv kortform (10 min) — bedre enn null |
| Vag "alt fungerer"-handoff | Konkret PR-list + LOC + tester |
| Etterlate uncommitted endringer | Stash + dokumenter i handoff, eller commit som WIP-PR |
| Skip PITFALLS-update "fordi jeg ikke fant noe" | Skriv eksplisitt: "Ingen nye fallgruver denne sesjonen" |
| Anta neste PM "vil finne ut" | Skriv eksplisitt prosedyre i handoff |
| Lukke todos uten å flytte til handoff | Hver pending todo må enten merges i handoff eller eksplisitt avvises med grunn |

---

## Sesjons-slutt-kommando-batch

For raskere prosedyre, kopier denne batchen ved sesjons-slutt:

```bash
cd /Users/tobiashaugen/Projects/Spillorama-system

# 1. Sjekk PR-er
gh pr list --author "@me" --state all --search "created:>=$(date -v-1d +%Y-%m-%d)" --json number,title,state,mergedAt

# 2. Sjekk git-state
git status -sb

# 3. Sjekk main er friskt etter siste merge
git log origin/main --oneline -5

# 4. Generer status-snapshot (hvis pm-onboarding finnes)
./scripts/pm-onboarding.sh > /tmp/pm-final-state.md

# 5. Verify monitor + stack-state
curl -s -m 3 http://localhost:4000/health | head -c 200
ls /tmp/pilot-monitor*.pid 2>/dev/null

# 6. (Når levert) Kjør session-end-verifikasjon
bash scripts/pm-session-end.sh
```

Etter dette: skriv PM_HANDOFF + PM_SESSION_KNOWLEDGE_EXPORT (Trinn 2 + 3).

---

## Relaterte filer

- `docs/operations/PM_SESSION_START_CHECKLIST.md` — motsatt prosedyre (ny PM)
- `docs/operations/PM_SESSION_KNOWLEDGE_EXPORT_TEMPLATE.md` — mal for Trinn 3
- `docs/engineering/PM_ONBOARDING_PLAYBOOK.md` — komplett PM-rutine
- `scripts/pm-session-end.sh` — interaktiv runner (under-impl)

---

## Endringslogg

| Dato | Endring |
|---|---|
| 2026-05-14 | Initial — eksplisitt prosedyre etablert per Tobias-direktiv ("Hvordan denne rutinen er — har du lagt inn at hver avsluttende PM skal lage et detaljert handoff dokument?") |
