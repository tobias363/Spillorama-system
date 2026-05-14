# PM Session START Checklist — eksakt prosedyre

**Status:** Autoritativ. Kjøres av NY PM ved hver sesjons-start.
**Tobias-direktiv 2026-05-14 IMMUTABLE:** "Ny PM skal lese ABSOLUTT ALT før første kode-handling. Vanntett og 100% sikre."
**Forventet tid:** 90-180 min for full onboarding hvis du er helt ny til prosjektet, 30-60 min hvis du tar over fra forrige PM samme dag.

---

## Hvorfor denne fila eksisterer

Tidligere PM-rutine var "les hva som er relevant for oppgaven". Resultat: PM-er gjentok fallgruver, spurte Tobias om ting han allerede hadde svart på, mistet kontekst-kontinuitet.

Tobias-direktiv 2026-05-14: ABSOLUTT ALT må leses FØR første kode-handling. Vanntett — fysisk umulig å skippe.

---

## ⛔ Kontinuitet-direktiv (Tobias 2026-05-15) — LES FØRST

> "Kan du også da legge inn i tekst til ny PM at han da må fortsette i samme spor og arkitektur når han fortsetter med sitt arbeid og dokumenterer fortløpende."
> — Tobias 2026-05-15

**Som ny PM som tar over, du MÅ:**

1. **Fortsette i samme spor.** Hvis forrige PM jobbet med en P0-blokker (Next Game Display-bug, casino-grade Bølge X, pilot-utrulling), så fortsetter DU med samme blokker. Ikke pivoter til nye initiativ uten eksplisitt Tobias-godkjennelse.

2. **Fortsette i samme arkitektur.** Hvis forrige PM etablerte et mønster (SESSION_KNOWLEDGE_EXPORT, vanntett-gate-prinsippet, single-source-of-truth, parallel-research-agenter), så VIDEREFØRER DU det. Brudd på etablert arkitektur krever ADR + Tobias-godkjennelse i samme sesjon.

3. **Dokumenter fortløpende — ikke ved sesjons-slutt.** Skriv PITFALLS_LOG-entry NÅR du oppdager fallgruven. Oppdater skill NÅR du oppdager mønsteret. Skriv ADR NÅR beslutningen tas. Sesjons-slutt-checklist er for verifikasjon, ikke for første-gangs-dokumentasjon.

4. **Hver fix-agent-prompt MÅ inneholde dokumentasjons-protokoll** (§2.19 IMMUTABLE — mal i `docs/engineering/SKILL_DOC_PROTOCOL_TEMPLATE.md`).

5. **Når i tvil — les playbook + spør Tobias.** Bedre å pause 5 min for å sjekke en doc enn å implementere noe som bryter etablert pattern.

Full forklaring i [`docs/engineering/PM_QUICK_REFERENCE.md`](../engineering/PM_QUICK_REFERENCE.md) §0.

---

## 13 obligatoriske trinn (i rekkefølge)

### Trinn 0 — Onboarding-gate (HARD-BLOCK)

```bash
cd /Users/tobiashaugen/Projects/Spillorama-system
bash scripts/pm-checkpoint.sh --validate
```

Hvis exit ≠ 0 → kjør interaktiv: `bash scripts/pm-checkpoint.sh`

Den krever per-fil-bekreftelse av ALLE `docs/operations/PM_HANDOFF_*.md` siden 2026-04-23 med 1-3 setn. takeaway.

- [ ] Gate passert (`.pm-onboarding-confirmed.txt` finnes og er ≤ 7 dager)

### Trinn 0.5 — Vanntett doc-absorpsjon-gate (NY 2026-05-14, under-impl)

```bash
bash scripts/pm-doc-absorption-gate.sh --validate
```

Hvis exit ≠ 0 → kjør interaktiv. Krever per-fil-bekreftelse av:
- Alle ADR-er (0001-0023+)
- Alle PITFALLS_LOG-seksjoner (§1-§12)
- Alle topp-8 skills (spill1-master-flow, wallet-outbox-pattern, audit-hash-chain, pm-orchestration-pattern, live-room-robusthet-mandate, pengespillforskriften-compliance, spill2-perpetual-loop, spill3-phase-state-machine)
- Alle PM_SESSION_KNOWLEDGE_EXPORT-filer (siden 2026-04-23)
- AGENT_EXECUTION_LOG topp 30 entries

- [ ] Doc-absorpsjon-gate passert (`.pm-doc-absorption-confirmed.txt` finnes og er ≤ 7 dager)

> **Status 2026-05-14:** Gate-script under implementering av agent. Inntil levert: dekk lesingen manuelt per Trinn 2 nedenfor.

### Trinn 1 — Generer live current-state-rapport

```bash
./scripts/pm-onboarding.sh > /tmp/pm-onboarding.md
cat /tmp/pm-onboarding.md
```

Gir deg: forrige PM-handoff, R1-R12 status, dev-stack-helse, åpne PR-er, aktive worktrees, BACKLOG-saker.

- [ ] /tmp/pm-onboarding.md lest

### Trinn 2 — Les forrige PM's leveranser (KRITISK)

I denne rekkefølgen:

1. **`docs/operations/PM_HANDOFF_<siste-dato>.md`** (forrige sesjons-handoff — beslutninger + status)
2. **`docs/operations/PM_SESSION_KNOWLEDGE_EXPORT_<siste-dato>.md`** (forrige sesjons tacit knowledge — mental models, Tobias-signaler, anti-mønstre)

Hvis flere handoffs siden du sist var aktiv (eller hvis du er helt ny), les ALLE i kronologisk rekkefølge.

- [ ] PM_HANDOFF_<dato> lest fullt
- [ ] PM_SESSION_KNOWLEDGE_EXPORT_<dato> lest fullt
- [ ] Eldre handoffs siden 2026-04-23 lest (hvis ny til prosjektet)

### Trinn 3 — Les `PM_ONBOARDING_PLAYBOOK.md` §1-§11

```bash
less docs/engineering/PM_ONBOARDING_PLAYBOOK.md
```

Særlig viktig:
- §2 — Tobias' IMMUTABLE direktiver (12+)
- §3 — Trinn-for-trinn-rutine
- §5 — Kommunikasjons-mønstre med Tobias
- §9 — Anti-mønstre og fallgruver
- §10 — Sjekkpunkter for fullført onboarding

- [ ] Playbook lest

### Trinn 4 — Spawn parallelle Explore-agenter for resterende docs

PM kan IKKE lese alt selv på rimelig tid. Spawn 3-5 parallelle Explore-agenter:

```typescript
Agent({
  description: "Read ADRs 0002-0023",
  subagent_type: "Explore",
  run_in_background: true,
  prompt: "Read all ADRs in docs/adr/0002-0023*.md and summarize to /tmp/pm-adrs-summary.md. Max 1 paragraph per ADR."
})

Agent({
  description: "Read PITFALLS §2/§5/§6/§8/§9/§10/§12",
  subagent_type: "Explore",
  run_in_background: true,
  prompt: "Read docs/engineering/PITFALLS_LOG.md sections §2, §5, §6, §8, §9, §10, §12. Summarize critical entries (severity P0/P1) to /tmp/pm-pitfalls-summary.md."
})

Agent({
  description: "Read all PM_SESSION_KNOWLEDGE_EXPORT-files",
  subagent_type: "Explore",
  run_in_background: true,
  prompt: "Read all docs/operations/PM_SESSION_KNOWLEDGE_EXPORT_*.md files chronologically. Summarize key mental models + anti-patterns + Tobias-signals to /tmp/pm-session-exports-summary.md."
})

Agent({
  description: "Read compliance docs",
  subagent_type: "Explore",
  run_in_background: true,
  prompt: "Read docs/compliance/ recent files. Identify regulatory requirements + current audit-state to /tmp/pm-compliance-summary.md."
})

Agent({
  description: "Read remaining 12+ skills",
  subagent_type: "Explore",
  run_in_background: true,
  prompt: "Read .claude/skills/* (skills not in top-8). Summarize when each is relevant to /tmp/pm-skills-summary.md."
})
```

Per §11.14: max 6-8 parallelle. 5 her er trygt.

- [ ] 3-5 Explore-agenter spawnet

### Trinn 5 — Vent på agent-leveranser + absorber

Når notification kommer per agent:
- Les `/tmp/pm-<scope>-summary.md`
- Marker takeaways

- [ ] Alle 3-5 agent-sammendrag lest

### Trinn 6 — Verifiser MCP-er live

```bash
# Sentry (via MCP):
# Prøv search_issues mot org=spillorama med limit=1

# PostHog (via MCP):
# Prøv organizations-list

# Postgres-prod (via MCP):
# Prøv SELECT 1 fra mcp__postgres-spillorama-prod__query

# Postgres-lokal (når dev:nuke kjørt):
# Sjekk mcp__postgres-spillorama__list_schemas
```

- [ ] Sentry MCP live
- [ ] PostHog MCP live
- [ ] Postgres-prod MCP live (read-only per ADR-0023)
- [ ] Postgres-lokal MCP live (etter dev:nuke)

### Trinn 7 — Verifiser dev-stack live (eller be Tobias kjøre dev:nuke)

```bash
curl -s -m 3 http://localhost:4000/health
lsof -nP -iTCP:5174 -sTCP:LISTEN -t  # admin-web
lsof -nP -iTCP:5173 -sTCP:LISTEN -t  # game-client
docker ps --format '{{.Names}}: {{.Status}}'
```

Hvis nede, gi Tobias kommandoen:
```bash
cd /Users/tobiashaugen/Projects/Spillorama-system && npm run dev:nuke
```

- [ ] Backend (4000) live
- [ ] Admin-web (5174) live
- [ ] Game-client (5173) live
- [ ] Docker (Postgres + Redis) live

### Trinn 8 — Verifiser pilot-monitor live (per §2.18 IMMUTABLE)

```bash
ls -la /tmp/pilot-monitor*.pid
```

Hvis ingen PID-filer, gi Tobias kommandoen:
```bash
cd /Users/tobiashaugen/Projects/Spillorama-system && bash scripts/start-monitor-with-push.sh
```

Per §2.18 i playbook: monitor MÅ være aktiv før testing. Kan IKKE skippes.

- [ ] Monitor + push-daemon live

### Trinn 9 — Selv-test "TOP 10 PM må vite"

Forrige PM's KNOWLEDGE_EXPORT §6 har en "Mental hand-off — 10 bullets neste PM må vite". Kan du svare på de 10 punktene uten å slå opp?

Hvis du kan ≥ 7 av 10 → bra.
Hvis < 7 → re-les KNOWLEDGE_EXPORT §6 + handoff TL;DR.

- [ ] Selv-test bestått (≥ 7 av 10)

### Trinn 10 — Verifiser git-state

```bash
cd /Users/tobiashaugen/Projects/Spillorama-system
git status -sb  # forventet: clean
git log origin/main --oneline -5  # forventet: siste merge fra forrige PM
git branch -a | grep -v dependabot | head -10  # sjekk aktive branches
```

Hvis uncommitted endringer eller "behind X commits" — pull eller stash før du starter.

- [ ] Git-state clean på main
- [ ] origin/main pulled (fast-forward)

### Trinn 11 — Bekreft til Tobias

Skriv kort melding:

```
Onboarding fullført. Status:
- Gate passert: ✅
- Doc-absorpsjon: ✅ (X handoffs + Y ADRs + Z PITFALLS-seksjoner lest)
- Dev-stack: ✅
- Monitor: ✅
- MCP-er: ✅ (4/4 live)

Klar til arbeid. Hva er prioritet?
```

- [ ] Bekreftelse sendt til Tobias

### Trinn 12 — Vent på Tobias-direktiv eller plukk opp åpne tasks

Hvis Tobias har gitt klar prioritet i handoff "Åpne tasks for neste PM": start der.
Hvis Tobias venter input: spør om prioritet.

ALDRI start kode-handling før Trinn 0-11 er passert.

- [ ] Klar til første kode-handling

---

## Anti-mønstre ny PM må unngå ved sesjons-start

| ❌ Aldri | ✅ I stedet |
|---|---|
| "Jeg leser det jeg trenger underveis" | Trinn 0-11 først, kode etter |
| Skip pm-checkpoint.sh "fordi gate fra i går er gyldig" | Sjekk minst `--validate` → arvet gate OK |
| Anta dev-stack er live "fordi det var i går" | Verifiser med `curl /health` |
| Start testing uten monitor live | §2.18 IMMUTABLE — monitor MÅ være på |
| Spør Tobias om noe forrige PM allerede dokumenterte | Søk PM_HANDOFF + KNOWLEDGE_EXPORT først |
| Gjette på rot-årsak før diagnose | Per PITFALLS §6.6: maks 2 manuelle iterasjoner uten test |
| Hopp over Tobias-direktiver i §2 av playbook | De er IMMUTABLE — overstyrer alt annet |

---

## Tidsbudsjett

| Type PM-overgang | Forventet onboarding-tid |
|---|---|
| Helt ny til prosjektet | 3-4 timer (Trinn 0-11 inkl. agent-sammendrag) |
| Tar over fra forrige PM samme dag | 30-60 min (Trinn 1-11, gate-arv) |
| Resumé etter < 4 timer pause | 10-15 min (Trinn 7-11 + sjekk Sentry-feed) |

---

## Relaterte filer

- `docs/operations/PM_SESSION_END_CHECKLIST.md` — motsatt prosedyre (avsluttende PM)
- `docs/operations/PM_SESSION_KNOWLEDGE_EXPORT_TEMPLATE.md` — mal for sesjons-eksport
- `docs/engineering/PM_ONBOARDING_PLAYBOOK.md` — komplett PM-rutine
- `scripts/pm-checkpoint.sh` — eksisterende handoff-gate
- `scripts/pm-doc-absorption-gate.sh` — under-impl (doc-absorpsjon)
- `scripts/pm-onboarding.sh` — current-state-snapshot

---

## Endringslogg

| Dato | Endring |
|---|---|
| 2026-05-14 | Initial — eksplisitt prosedyre etablert per Tobias-direktiv ("Hvordan denne rutinen er — har du lagt inn at hver avsluttende PM skal lage et detaljert handoff dokument slik at ny PM vet akkurat hva den må gjøre?") |
