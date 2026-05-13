# Cross-Knowledge Audit — drift-deteksjon mellom kunnskaps-kilder

**Status:** Aktiv. Kjøres ukentlig av CI.
**Etablert:** 2026-05-13
**Eier:** PM-AI
**Tobias-direktiv 2026-05-13:**
> "Det må bli vanntett nå ellers vil det ikke funke. Kan du anbefale noe annet her for at dette skal gå av seg selv og at da agentene blir smartere utifra arbeid som blir gjort fordi dokumentasjon alltid oppdateres?"

---

## 0. Hvorfor dette eksisterer

Spillorama har 7 kunnskaps-pilarer (PITFALLS_LOG, FRAGILITY_LOG, BUG_CATALOG, AGENT_EXECUTION_LOG, ADR-er, skills, live-monitor). Hver pilar oppdateres manuelt — og når de fire faktiske-mennesker-pilarene (PITFALLS, FRAGILITY, BUG_CATALOG, AGENT_LOG) ikke matcher den autoritative kilden (Linear-issues, faktiske ADR-er, faktisk PR-state), oppstår **drift**.

Drift gir falske trygghets-signaler:
- En agent leser PITFALLS-§ og tror et problem er "åpent" — men Linear-issuet ble lukket for tre uker siden
- En PM ser en BACKLOG-item uten BIN-ref og er usikker på om det fortsatt er prioritet
- En skill peker på `ADR-012` — men ADR-12 ble erstattet av ADR-22 i forrige uke
- En BUG_CATALOG-rad er merket `✅ Merged` uten commit-SHA, som bryter Done-policy (ADR-0010)

Denne audit-en detekterer disse driftene **automatisk** ved å sammenligne kilder mot hverandre, og publiserer en rapport som er enkel å handle på.

---

## 1. De 8 drift-sjekkene

| # | Sjekk | Hva den fanger | Severity-skala |
|---|---|---|---|
| 1 | **PITFALLS-§ references closed Linear issue** | PITFALLS-§ refererer BIN-NNN som er `completed`/`canceled` i Linear, men §-statusen ikke oppdatert | 🟡 (med Linear) / ℹ️ (uten Linear) |
| 2 | **FRAGILITY-file-cluster** | Samme fil dukker opp i ≥ 3 FRAGILITY-entries → arkitektonisk hot-spot | 🔴 |
| 3 | **BACKLOG-item without Linear-link** | Checkbox-item i BACKLOG.md uten BIN-NNN-referanse | 🟡 |
| 4 | **BUG_CATALOG ✅ Merged without commit-SHA** | Rad i Fix-PR-kolonne markert ✅ uten commit-SHA/PR-ref/branch-name | 🟡 |
| 5 | **ADR Superseded chain integrity** | ADR sier `Superseded by ADR-MMMM` men MMMM finnes ikke, eller refererer ikke tilbake | 🔴 / 🟡 |
| 6 | **Skills referencing dead ADRs** | Skill peker på `ADR-NNN` som ikke eksisterer i `docs/adr/` | 🟡 |
| 7 | **PM_HANDOFF mentions OPEN PR that's merged** | Siste handoff sier "open" / "pending" om en PR som faktisk er merget | ℹ️ |
| 8 | **PR template knowledge-protocol checklist** | PR-template mangler checkbox for PITFALLS_LOG / FRAGILITY_LOG / SKILL-update / AGENT_EXECUTION_LOG | 🟡 |

### Severity-tolkning

| Symbol | Betyr | Handling |
|---|---|---|
| 🔴 RED | Arkitektonisk eller integritets-brudd | Tobias-eskalering anbefalt; refaktor-vurdering |
| 🟡 YELLOW | Drift som bør lukkes innen rimelig tid | Inkluder i neste PR som rører området |
| ℹ️ INFO | Informativ — ikke nødvendigvis feil | Bare orientering; ingen automatisk handling |

---

## 2. Hvor ofte vi kjører

| Trigger | Når | Hva skjer |
|---|---|---|
| **`schedule`** | Hver mandag kl 10:00 UTC | Full audit, commit av rapport, opprett issue ved drift |
| **`workflow_dispatch`** | Manuell trigger fra GitHub Actions UI | Samme som schedule, men med ekstra parametre |
| **`push` til main** | Når audit-script, workflow eller doc endres | Kjør for å verifisere at ingenting brytes |

Lokal kjøring:
```bash
# Full audit, output til stdout
node scripts/cross-knowledge-audit.mjs

# Skriv til fil
node scripts/cross-knowledge-audit.mjs --output=docs/auto-generated/CROSS_KNOWLEDGE_AUDIT.md

# Skip Linear-sjekk (Check 1)
node scripts/cross-knowledge-audit.mjs --no-linear

# JSON-output for scripting
node scripts/cross-knowledge-audit.mjs --json

# Exit 1 hvis drift detekteres (for CI-gating)
node scripts/cross-knowledge-audit.mjs --fail-on-findings

# Verbose logging til stderr
node scripts/cross-knowledge-audit.mjs --verbose
```

---

## 3. Hvordan handle på funn

### Trinn 1 — Les rapporten

Etter ukentlig kjøring oppdateres `docs/auto-generated/CROSS_KNOWLEDGE_AUDIT.md` av CI. Hvis det er drift, opprettes også en GitHub-issue (label: `cross-knowledge-audit`).

### Trinn 2 — Triagér

For hver finding, klassifiser:

1. **Ekte drift** → fix i samme uke (eller i neste relevante PR)
2. **Falsk-positiv** → dokumenter i kommentar; vurder om sjekken skal raffineres
3. **Akseptert teknisk gjeld** → flag i Linear og marker som "kjent drift inntil ..."

### Trinn 3 — Fiks i prioritert rekkefølge

Anbefalt rekkefølge:

1. 🔴 **RED** — ADR-chain-brudd og arkitektoniske hot-spots
2. 🟡 **YELLOW** — Done-policy-brudd (Check 4) og dokumentasjons-drift
3. ℹ️ **INFO** — opportunistisk, neste gang du er i området

### Trinn 4 — Lukk issuen

Når alle 🔴/🟡-funn er adressert (eller dokumentert som falsk-positive), lukk GitHub-issuen. Neste mandag genereres ny rapport.

---

## 4. Hvilke kilder vi sjekker

| Kilde | Fil | Type | Hvilke sjekker bruker den |
|---|---|---|---|
| Linear-issues | `https://linear.app/bingosystem` | Ekstern API | Check 1 |
| PITFALLS-katalog | `docs/engineering/PITFALLS_LOG.md` | Manuell md | Check 1 |
| FRAGILITY-katalog | `docs/engineering/FRAGILITY_LOG.md` | Manuell md | Check 2 |
| BACKLOG | `BACKLOG.md` | Manuell md | Check 3 |
| Bug-katalog | `tests/e2e/BUG_CATALOG.md` | Manuell md | Check 4 |
| ADR-er | `docs/adr/NNNN-*.md` | Manuell md | Check 5, 6 |
| Skills | `.claude/skills/*/SKILL.md` | Manuell md | Check 6 |
| PM-handoffs | `docs/operations/PM_HANDOFF_*.md` | Manuell md | Check 7 |
| GitHub PR-state | `gh pr view` CLI | Ekstern API | Check 7 |
| PR-template | `.github/pull_request_template.md` | Manuell md | Check 8 |

---

## 5. Linear-tilgang

Audit-en støtter Linear API men krever det ikke:

| Modus | Hvordan aktivere | Effekt |
|---|---|---|
| **Med Linear** | `LINEAR_API_KEY` env-var ELLER `secrets/linear-api.local.md` med nøkkel | Check 1 kjører fullt |
| **Uten Linear** | `--no-linear` flagg ELLER ingen nøkkel funnet | Check 1 skipper med ℹ️-notis |

I CI-workflow leses `LINEAR_API_KEY` som GitHub-secret. Hvis ikke satt, kjøres `--no-linear` automatisk.

For lokal-bruk:
```bash
# Alternativ 1: env-var
export LINEAR_API_KEY="lin_api_..."
node scripts/cross-knowledge-audit.mjs

# Alternativ 2: secrets-fil
cp secrets/linear-api.template.md secrets/linear-api.local.md
# Rediger filen, lim inn nøkkel mellom ``` blokker
node scripts/cross-knowledge-audit.mjs
```

> **Note om Linear MCP:** Hvis du har Linear MCP koblet via Claude/Cowork, bruker du den direkte i chat — du trenger ikke en personal API key for daglig bruk. Denne audit-en bruker REST-API direkte fordi den kjøres i CI uten MCP-tilgang.

---

## 6. Hvordan legge til nye drift-sjekker

### Trinn 1 — Identifiser drift-mønsteret

Spør deg selv:
- "Hvilke to (eller flere) dokumenter / kilder bør si det samme?"
- "Hva er konsekvensen hvis de er uenige?"
- "Kan jeg detektere uenighet automatisk uten falske positive?"

Gode kandidater:
- En annen kombinasjon av eksisterende kilder
- Ny kilde som introduseres (eks. ny `INCIDENT_LOG.md` som bør speile compliance-feiler)
- Kryss-validering mot ekstern API (eks. Render-deploy-status, Sentry-issue-status)

### Trinn 2 — Implementer sjekken

I `scripts/cross-knowledge-audit.mjs`, legg til en ny async-funksjon:

```javascript
async function check9MyNewCheck(state) {
  const findings = [];

  // Les kildene fra state.sources eller direkte
  const someContent = state.sources.fragility;
  if (!someContent) return findings;

  // Detekter drift
  if (/* drift-betingelse */) {
    findings.push({
      check: 9,
      severity: SEVERITY.YELLOW,  // eller RED / INFO
      title: "Short, action-oriented title",
      detail: "Multi-line explanation. What was found, where, how to fix.",
      file: "path/to/source.md",  // valgfritt
      line: 42,                    // valgfritt
    });
  }

  return findings;
}
```

Legg til sjekken i `runAudit()`:

```javascript
const checks = [
  { id: 1, name: "...", fn: check1PitfallsClosedLinear },
  // ...
  { id: 9, name: "My new check", fn: check9MyNewCheck },
];
```

### Trinn 3 — Test lokalt

```bash
node scripts/cross-knowledge-audit.mjs --verbose
```

Verifiser:
- Sjekken kjører (verbose-log viser "Running check 9")
- Den finner faktiske drift-tilfeller
- Den finner IKKE falske positive

### Trinn 4 — Dokumenter

- Oppdater `## 1. De 8 drift-sjekkene`-tabellen øverst i denne filen (gjør den til "## 1. De N drift-sjekkene")
- Inkluder rasjonale: "hvorfor flagger vi denne typen drift?"
- Beskriv hvordan utvikler skal handle på funn

### Trinn 5 — PR

Lag PR med:
- Endring i `scripts/cross-knowledge-audit.mjs`
- Endring i `docs/engineering/CROSS_KNOWLEDGE_AUDIT.md`
- AGENT_EXECUTION_LOG-entry

Test-kjøring av audit-workflow vises i CI.

---

## 7. Hva audit-en IKKE detekterer (kjente begrensninger)

- **Subtil semantisk drift:** Audit-en sjekker struktur, ikke betydning. Hvis to docs sier ulike ting med samme ord, ikke fanget.
- **Stille foreldelse:** Hvis en PITFALLS-§ ikke nevner noen BIN, kan vi ikke vite om den er stale.
- **Cross-handoff-konsistens:** Vi sjekker kun siste PM-handoff (Check 7), ikke om to handoffs sier motstridende ting.
- **Skill ↔ kode-drift:** Hvis en skill sier "bruk WalletAdapter.transfer()" men metoden er fjernet, ikke fanget.

For disse, se manuelle prosesser i [`KNOWLEDGE_AUTONOMY_PROTOCOL.md`](./KNOWLEDGE_AUTONOMY_PROTOCOL.md) Pillar 5 (Skill-evolution Tier 2).

---

## 8. Eksempel-output

```markdown
# Cross-Knowledge Audit Report

**Date:** 2026-05-13
**Generated:** 2026-05-13T13:09:19.769Z
**Drift findings:** 2
**Architectural concerns:** 1
**Info-notices:** 3

## Findings

### Check 2

#### 🔴 Architectural fragility: `apps/backend/src/game/MasterActionService.ts` appears in 3 FRAGILITY entries

File `apps/backend/src/game/MasterActionService.ts` is referenced in F-02, F-04, F-05. This
indicates an architectural hot-spot — consider refactor or arkitektur-review.

### Check 8

#### 🟡 PR template missing 4/4 knowledge-protocol checkboxes

Missing: PITFALLS_LOG, FRAGILITY_LOG, SKILL update, AGENT_EXECUTION_LOG. ...

## Architectural fragility summary

| File | FRAGILITY entries | Count |
|---|---|---:|
| `apps/backend/src/game/MasterActionService.ts` | F-02, F-04, F-05 | 3 |
| ...

## Recommended actions

- **Architectural review:** 1 file(s) flagged with 3+ FRAGILITY entries — schedule a refactor session with Tobias.
- **Update PR template:** Knowledge-protocol checkboxes missing — see Check 8 finding for exact additions.
```

---

## 9. Kobling til andre prosesser

### Knowledge Autonomy Protocol (Pillar 1-7)

Cross-knowledge-audit er **Pillar 8** — selv-tilsyn av at Pillar 1-7 holder konsistens.

| Pillar | Forhold til audit |
|---|---|
| 1 PITFALLS_LOG | Check 1 verifiserer Linear-status; Check 2 brukes ikke direkte men implisert |
| 2 FRAGILITY_LOG | Check 2 finner hot-spots |
| 3 BUG_CATALOG | Check 4 verifiserer Done-policy |
| 4 AGENT_EXECUTION_LOG | (ikke direkte sjekket; manuelt review-ansvar) |
| 5 Skills | Check 6 verifiserer ADR-refs |
| 6 Live-monitor | (uavhengig; runtime-fokus) |
| 7 Context-pack | (uavhengig; pre-work-fokus) |

### Done-policy (ADR-0010)

Check 4 håndhever Done-policy for `tests/e2e/BUG_CATALOG.md`: rader markert ✅ Merged må ha commit-SHA, PR-ref, eller branch-navn for å gi audit-trail.

### PM-onboarding (PM_ONBOARDING_PLAYBOOK)

Ny PM bør sjekke `docs/auto-generated/CROSS_KNOWLEDGE_AUDIT.md` som del av onboarding for å se aktive drifts. Legges til som steg i playbook ved neste revisjon.

---

## 10. Endringslogg

| Dato | Endring | Forfatter |
|---|---|---|
| 2026-05-13 | Initial — 8 drift-sjekker, ukentlig CI-kjøring, auto-issue-opprettelse | Agent |
