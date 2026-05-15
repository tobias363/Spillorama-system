# Incident Mode vs Knowledge Protocol — Prioritets-rekkefølge

**Status:** Autoritativ fra 2026-05-16
**Eier:** Tobias Haugen / PM-AI
**Relatert ADR:** [ADR-0024](../adr/0024-pm-knowledge-enforcement-architecture.md)

> **Formål:** Når en P1-incident treffer mens agent-contract-flow eller knowledge-protocol-flyt er aktiv, må PM vite hvilket regelsett som vinner uten å lete. Ingen kollisjon under press.

---

## Bottom line — på 30 sekunder

| Situasjon | Hvilken flyt vinner |
|---|---|
| **P1 active customer impact** (live-rom henger, prod 502, wallet-feil) | [`EMERGENCY_RUNBOOK.md`](./EMERGENCY_RUNBOOK.md) — skip knowledge-gates |
| **Compliance-incident** (limit ikke håndhevet, audit-trail brudd) | [`COMPLIANCE_INCIDENT_PROCEDURE.md`](./COMPLIANCE_INCIDENT_PROCEDURE.md) — skip knowledge-gates |
| **Sikkerhetsincident** (mistanke om brudd, datalekkasje) | [`INCIDENT_RESPONSE_PLAN.md`](./INCIDENT_RESPONSE_PLAN.md) + ring Tobias — skip alt annet |
| **P2** (én hall feiler, andre OK) | [`AGENT_TASK_CONTRACT.md`](../engineering/AGENT_TASK_CONTRACT.md) — standard knowledge-protocol |
| **Pilot-feature-arbeid pre-launch** | `AGENT_TASK_CONTRACT.md` — standard |
| **Docs-only / auto-bot** | Knowledge-gates ikke applicable. Bruk `gate-not-applicable:` med riktig rolle |

---

## Hvorfor denne prioriteten

Knowledge-protocol er bygget for å forhindre "2 skritt frem, 1 tilbake"-mønsteret over uker og måneder. Tids-horisonten for fallgruve-mønsteret er **dager-til-uker**.

Under P1 er tids-horisonten **minutter**. Spillere kan ikke logge inn. Live-rom henger. Wallet viser feil balanse. Hver minutt koster forretning og compliance-risiko.

Å tvinge en PM gjennom onboarding-gate + doc-absorption + self-test + fact-bound contract før de kan rolle back en deploy = feil optimaliserings-mål. Knowledge-protocol gjenopptas **etter** incident, ikke under.

---

## Konkret prosedyre ved P1

### Steg 1 — De første 5 minuttene

1. **Verifiser at det er P1** (faktisk live impact, ikke bare alert). Se [`EMERGENCY_RUNBOOK.md`](./EMERGENCY_RUNBOOK.md) §"Først: Er det egentlig en emergency?".
2. **Hvis P1:** følg `EMERGENCY_RUNBOOK.md` uten å åpne knowledge-protocol-rutiner.
3. **Forsøk Tobias 5 minutter** (SMS + telefon). Hvis ikke svar — du har autonomi (se autonomi-liste i `EMERGENCY_RUNBOOK.md`).

### Steg 2 — Hotfix-PR-format under P1

PR-body **skal** inneholde:

```text
gate-bypass: hotfix-incident-YYYY-MM-DD
[bypass-knowledge-protocol: hotfix]
[bypass-fragility-check: hotfix]

## Incident
- Tid: <ISO timestamp>
- Symptomer: <kort>
- Severity: P1

## Fix
- <hva endret seg>

## Test
- <hvilke tester ble kjørt, eller "ingen — incident-fix">

## Post-incident-followup
- Postmortem innen 24t i `docs/postmortems/`
- Knowledge-update PR innen 7 dager
```

Bypass-label `approved-emergency-merge` settes av Tobias eller PM med autonomi.

### Steg 3 — Innen 24 timer etter at incident er stabilisert

PM (eller agent under PM-koordinering) skal levere:

1. **Postmortem** i `docs/postmortems/<dato>-<incident-slug>.md`:
   - Hva skjedde
   - Hvorfor (rotårsak, ikke symptom)
   - Hva vi gjorde
   - Hva kunne gått bedre
   - Konkrete preventive endringer
2. **Knowledge-update PR** med:
   - Oppdatert `PITFALLS_LOG.md` hvis nytt mønster
   - Oppdatert relevant `.claude/skills/<skill>/SKILL.md` hvis arkitektur-påvirkning
   - Entry i `AGENT_EXECUTION_LOG.md`
   - ADR hvis hotfix introduserte nytt arkitektur-mønster
   - PR-body: `post-incident-knowledge: hotfix-incident-YYYY-MM-DD`-referanse

### Steg 4 — Audit-trail

`cross-knowledge-audit-weekly.yml` skal flagge incidents uten knowledge-followup som drift (**planlagt utvidelse — ikke implementert i denne PR-en**).

Inntil da: Tobias manuell stikkprøve. Liste over åpne hotfix-incidents uten knowledge-followup vedlikeholdes som issue i `tobias363/Spillorama-system` med label `hotfix-knowledge-debt`.

---

## Edge cases

### "Knowledge-update fant feilen som forårsaket incident-en"

Hvis du under P1-respons oppdager at en eldre PR mangler PITFALLS-entry som ville advart deg:

- **IKKE** legg entry til i hotfix-PR-en (selv om det er fristende)
- Hotfix-PR skal være **minimal**
- Lag separat PR innen 24t for retroaktiv PITFALLS-update

### "Tobias er utilgjengelig under P1"

Se [`EMERGENCY_RUNBOOK.md`](./EMERGENCY_RUNBOOK.md) §"Eskalerings-rekkefølge". Du har autonomi til:

- Rollback via Render dashboard
- Feature-flag stengning
- Kommunikasjon til pilot-haller
- Stuck-room-cleanup via admin-endpoint

Du har **ikke** autonomi til:

- Compliance-tolkning
- Lotteritilsynet-rapportering
- Vendor-endringer
- Refunds utenfor normal flow

### "P1 vs P2 er uklart"

Anta **P2** og logg. P2 betyr standard knowledge-protocol gjelder. Eskaler til P1 hvis det utvikler seg (symptomer øker, flere haller rapporterer, time-to-recovery > 15 min).

### "Multiple incidents samtidig"

Adress **én av gangen**. Postmortem etterpå skal note hvilke ble håndtert i hvilken rekkefølge, og hvorfor.

### "Hotfix-PR feiler CI på en non-knowledge-check (eks. compliance-tests)"

Bypass-policy gjelder kun knowledge-gates. Compliance-tests, type-check, og pilot-hardware-test må fortsatt passere. Hvis hotfix bryter compliance-test, kan ikke merges.

**Unntak:** Hvis compliance-test er feil og du har bevis fra Lotteritilsynet eller eksisterende ADR, kan Tobias eksplisitt godkjenne med `approved-compliance-deviation` label. Dette er sjeldent og krever Tobias' aktive godkjenning, ikke bare autonomi.

---

## Cross-references

- [`EMERGENCY_RUNBOOK.md`](./EMERGENCY_RUNBOOK.md) — primær P1-runbook
- [`COMPLIANCE_INCIDENT_PROCEDURE.md`](./COMPLIANCE_INCIDENT_PROCEDURE.md) — compliance-spesifikke incidents
- [`INCIDENT_RESPONSE_PLAN.md`](./INCIDENT_RESPONSE_PLAN.md) — sikkerhets-incidents
- [`HOTFIX_PROCESS.md`](./HOTFIX_PROCESS.md) — tekniske hotfix-deploy-detaljer
- [`../engineering/AGENT_TASK_CONTRACT.md`](../engineering/AGENT_TASK_CONTRACT.md) — primær normal-flyt-protokoll
- [`../adr/0024-pm-knowledge-enforcement-architecture.md`](../adr/0024-pm-knowledge-enforcement-architecture.md) — meta-rasjonale
- [`../adr/0010-done-policy-legacy-avkobling.md`](../adr/0010-done-policy-legacy-avkobling.md) — Done-policy gjelder også for hotfix-knowledge-followup

---

**Sist oppdatert:** 2026-05-16 (introdusert)
