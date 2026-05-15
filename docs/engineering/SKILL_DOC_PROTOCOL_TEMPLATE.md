# Skill-doc-protokoll — template for fix-agent-prompts

**Status:** Autoritativ. Lim inn i HVER fix-agent-prompt.
**Sist oppdatert:** 2026-05-15
**Eier:** Tobias Haugen
**Direktiv:** PM_ONBOARDING_PLAYBOOK §2.19 (IMMUTABLE)

---

## Hvorfor denne template eksisterer

Tobias-direktiv 2026-05-14:

> "Vi har nå breifet agenter om at full dokumentasjon om arbeidet er viktig, slik at skillsene blir oppdatert med hva som nå funker og ikke slik at endrigner som gjør fremover da ikke endrer på en tidligere fiks? ... Kan du alltid legge det i rutinen til PM? det er ekstremt viktig for god progresjon og at vi kke går 2 skritt frem og 1 tilbake"

Uten skill+pitfalls-update i hver fix-PR går vi 2 skritt frem og 1 tilbake. Fremtidige agenter overskriver bevisste valg fordi konteksten ikke er kapret.

---

## Hvordan PM bruker denne

1. **Før jeg spawner en fix-agent**, identifiserer jeg:
   - Hvilken skill under `.claude/skills/` dekker scope-en (se "Skill-mapping" nedenfor)
   - Hvilken `PITFALLS_LOG`-§ er relevant (se "Pitfalls-mapping" nedenfor)
2. **Kopier-paster** template-seksjonen under inn i agent-prompt-en
3. **Tilpasser** PR-nummer + skill-navn + §-nummer per task
4. **Ved PR-review** sjekker jeg om docs faktisk ble oppdatert — hvis nei, follow-up commit
5. **Før PM åpner PR**, krever jeg Agent Delivery Report fra agenten i formatet fra [`AGENT_DELIVERY_REPORT_TEMPLATE.md`](./AGENT_DELIVERY_REPORT_TEMPLATE.md)
6. **For high-risk implementation-agent**, genererer jeg først en fact-bound agent-kontrakt med [`AGENT_TASK_CONTRACT.md`](./AGENT_TASK_CONTRACT.md):
   ```bash
   npm run agent:contract -- --agent "<navn>" --objective "<konkret mål>" --files <path> --evidence <rapport.md> --output /tmp/agent-contract.md
   ```

---

## Template-seksjon — paste this verbatim into fix-agent prompts

```markdown
## ⚠️ DOKUMENTASJONS-PROTOKOLL (KRITISK — Tobias-direktiv 2026-05-14, IMMUTABLE)

Tobias har bedt om at agenter MÅ oppdatere skills + PITFALLS_LOG som del av fix-en, slik at fremtidige agenter ikke overskriver fixen. Dette er IKKE valgfritt. PR vil ikke merges uten disse oppdateringene.

Som del av samme PR, oppdater følgende tre filer:

### 1. `.claude/skills/<SKILL-NAVN>/SKILL.md` (PM fyller inn navn)

Legg til ny seksjon (eller utvid eksisterende) som dokumenterer:

```markdown
## <Tema for fixen> (PR #<this-PR>)

**Hvorfor denne logikken eksisterer:**
<1-2 setninger om motivasjonen for fixen>

**Symptom hvis logikken fjernes/endres:**
<Konkret bug-symptom som vil komme tilbake>

**Hvordan unngå regresjon:**
<Konkret regel om hva fremtidige agenter ALDRI skal gjøre>

**Tester som beskytter mot regresjon:**
- `<path/til/test-fil>` (`<beskrivelse av test-coverage>`)

**Hva som nå funker:**
<Kort operativ forklaring, så neste PM/agent forstår normaltilstanden>

**Hva fremtidige agenter IKKE skal endre:**
<Eksplisitt invariant / "ALDRI gjør X"-regel>
```

### 2. `docs/engineering/PITFALLS_LOG.md` § <PM fyller inn §-nummer>

Legg til ny entry under riktig kategori:

```markdown
### §<X.Y> — <Kort tittel på fallgruven>

**Fallgruve:** <Beskrivelse av det som ble feil før fixen>

**Hvordan unngå:** <Konkret regel for fremtidige agenter>

**Detected by:** <Hvem oppdaget + når>
**Fixed in:** PR #<this-PR>
**Tester:** <path/til/test-fil>
```

### 3. `docs/engineering/AGENT_EXECUTION_LOG.md` (siste seksjon)

Legg til kronologisk entry:

```markdown
## YYYY-MM-DD — <Agent-navn> (<kort bug-beskrivelse>)

**Branch:** `<branch-navn>`
**PR:** #<this-PR>
**Trigger:** <Tobias-rapport / audit:db-finn / annet>

**Hva ble gjort:**
- <Bullet-liste over endringer>

**Lessons learned:**
- <Hva fremtidige agenter trenger å vite>

**Skill-update:** `<skill-path>` — <hvilken seksjon>
**Pitfall-update:** `PITFALLS_LOG.md` §<X.Y> — ny entry
```

## Knowledge protocol (sjekkliste — alle MÅ være krysset av før merge)

- [ ] Skill `<skill-navn>` oppdatert med ny/utvidet seksjon
- [ ] PITFALLS_LOG §<X.Y> oppdatert med ny entry
- [ ] AGENT_EXECUTION_LOG oppdatert med entry
- [ ] Test-coverage for fixen dokumentert i skill-seksjonen
- [ ] Eksplisitt "ALDRI gjør X"-regel i skill-en for fremtidige agenter
- [ ] Agent Delivery Report levert til PM med context read, invariants, tester, knowledge updates og åpne risikoer

PR vil bli rejektet hvis disse mangler.
```

---

## Skill-mapping (PM-referanse)

Hvilken skill dekker hvilket domene:

| Hvis fixen rør... | Relevant skill |
|---|---|
| Spill 1 master-flow, plan-runtime, scheduled-games | `spill1-master-flow` |
| Spill 2 perpetual loop, rocket-rom | `spill2-perpetual-loop` |
| Spill 3 phase-state-machine, monsterbingo | `spill3-phase-state-machine` |
| Wallet, outbox-pattern, REPEATABLE READ | `wallet-outbox-pattern` |
| Audit-trail, hash-chain | `audit-hash-chain` |
| Pengespillforskriften §11/§66/§71 | `pengespillforskriften-compliance` |
| Group of Halls, master-hall-binding | `goh-master-binding` |
| Live-rom-robusthet, R1-R12 | `live-room-robusthet-mandate` |
| PM-workflow, PR, git-flyt | `pm-orchestration-pattern` |
| SpinnGo databingo | `spinngo-databingo` |
| Master-konsoll UI, NextGamePanel | `agent-portal-master-konsoll` |
| Shift, settlement, agent | `agent-shift-settlement` |
| Customer Unique ID | `customer-unique-id` |
| Anti-fraud, velocity-deteksjon | `anti-fraud-detection` |
| R7/R8 health, alerting | `health-monitoring-alerting` |
| DR-runbook execution | `dr-runbook-execution` |
| Migration policy (idempotent, forward-only) | `database-migration-policy` |
| Trace-ID, observability MED-1 | `trace-id-observability` |
| Chaos-tests | `casino-grade-testing` |
| Candy iframe integration | `candy-iframe-integration` |

Hvis ingen skill matcher → vurder å lage ny skill (rare, men mulig).

---

## Pitfalls-mapping (PM-referanse)

`docs/engineering/PITFALLS_LOG.md` har 11 kategorier (per 2026-05-14):

| § | Tema |
|---|---|
| §1 | Compliance + regulatorisk |
| §2 | Wallet + outbox |
| §3 | Spill-arkitektur (Spill 1/2/3 forskjeller) |
| §4 | Live-rom-robusthet |
| §5 | Git, PR, branch-naming |
| §6 | Test (idempotens, teardown) |
| §7 | Frontend, game-client |
| §8 | Doc-disiplin, kode vs doc |
| §9 | Env-variabler, config |
| §10 | Routing, URL-paths |
| §11 | Agent-orkestrering, worktree |

Velg den som best matcher fixen. Hvis grenseland — velg den mest spesifikke.

---

## Eksempel: F2 (pre-engine 20kr-pris) — hvordan PM tilpasset template-en

For F2-agenten brukte jeg:

- **Skill:** `spill1-master-flow` (dekker `Game1MasterControlService` + ticket-config-propagering)
- **PITFALLS-§:** §3 (Spill-arkitektur — pre-engine vs post-engine state)
- **AGENT_EXECUTION_LOG:** ny entry under 2026-05-14

Resultat-prompt-seksjon: se `Agent F2 prompt` i sesjons-handoff fra 2026-05-14.

---

## Vedlikehold av denne template

Hvis Tobias gir ny direktiv som påvirker template — oppdater her. Hvis ny skill kommer til, legg til i mapping-tabellen. Template er kortet ned med vilje — overflødig detalj sliter ut agentenes context-budsjett.

Relatert strengere leveranseformat: [`AGENT_DELIVERY_REPORT_TEMPLATE.md`](./AGENT_DELIVERY_REPORT_TEMPLATE.md).
Relatert prompt-kontrakt: [`AGENT_TASK_CONTRACT.md`](./AGENT_TASK_CONTRACT.md).

**Eier:** PM. Oppdaterer ved hver større endring i PM-flyt eller nye skills.
