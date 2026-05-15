# ADR-0024 — PM Knowledge Enforcement Architecture

**Status:** Accepted
**Dato:** 2026-05-16
**Deciders:** Tobias Haugen (eier) + Claude PM-AI (forfatter)
**Konsulterer:** Konsulent-review 2026-05-16 (4 parallelle deep-reads av engineering/operations/scripts/skills)

## Kontekst

I løpet av 4 uker (2026-04-21 → 2026-05-15) er det bygget fire separate håndhevings-lag for å sikre at kunnskap overlever mellom PM-sesjoner og agent-leveranser. Hvert lag ble lagt på som svar på en konkret hendelse:

| Dato | Hendelse | Lag som ble lagt på |
|---|---|---|
| 2026-04-19 | `rsync --delete` overskrev live; Codex synket eldre branch → PR-endringer forsvant | Lag 4 (post-merge CI-watcher) — `pm-merge-verification.yml` |
| 2026-05-10 | PM-er hoppet over eldre handoffs → kontekst-tap | Lag 1 (onboarding-gate) — `pm-checkpoint.sh` |
| 2026-05-12 | Lokale commits gikk uten å passere gate | Lag 2 (pre-commit blokk) — `.husky/pre-commit` |
| 2026-05-13 | Merger gikk uten knowledge-update | Lag 3 (PR-merge gates) — 8 workflow-filer |
| 2026-05-15 | Agenter misforstod scope → "fact-bound contract" | Topp-lag på Lag 3 — `AGENT_TASK_CONTRACT.md` |

Hvert lag løste et reelt problem. Men det fantes ikke et samlet dokument som svarte:

- Hvorfor 4 lag i stedet for konsolidering?
- Hva er load-bearing og hva er polish?
- Når skal vi konsolidere?
- Hvilken bypass-bruk er akseptabel?

Mangelen på dette dokumentet skapte tre konkrete risikoer:

1. **Akselererende prosess-vekst.** 28% av commits siste uke var prosess-doks, opp fra 8% over 30 dager. Uten stop-kriterier kan dette bli 50% innen kort tid.
2. **Bypass-erosion.** 17 distinkte bypass-veier ble identifisert (env-var, commit-msg, PR-body, `--no-verify`). En hardkodet `gate-confirmed: 3dc25314e3df` i `auto-generate-docs.yml` kunne kopieres av hvem som helst og brukes som universal bypass.
3. **Tap av rasjonale.** Om 3 måneder vet ingen hvorfor systemet ser slik ut. Onboarding-byrden vokser (~3 timer ren lesing nå); ingen vet hvilke gates som faktisk fanger problemer vs. hvilke som er placebo.

Denne ADR-en dokumenterer eksisterende arkitektur og introduserer **eksplisitte konsolideringskriterier**.

## Beslutning

Vi beholder 4-lags arkitekturen **inntil videre**, med følgende eksplisitte rasjonale, scope og konsolideringskriterier.

### De 4 lagene — rolle og håndhevelse

| Lag | Mekanisme | Hva det fanger | Type håndhevelse |
|---|---|---|---|
| **1. Onboarding-gate** | `scripts/pm-checkpoint.sh` + `pm-doc-absorption-gate.sh` + `pm-knowledge-continuity.mjs` | "Har du lest handoffs og bygget operativ paritet?" | Pre-commit local (Husky) + audit-log på CI |
| **2. Pre-commit blokk** | `.husky/pre-commit` (6 trinn: PM-gate, intent, fragility, comprehension, resurrection, lint-staged) | "Forstår du faktisk det du endrer?" | Pre-commit local (kan omgås uten Husky) |
| **3. PR-merge gates** | 8 workflows (`pm-gate-enforcement`, `knowledge-protocol-gate`, `pitfalls-id-validate`, `skill-mapping-validate`, `bug-resurrection-check`, `delta-report-gate`, `skill-freshness-pr-check`, `ai-fragility-review`) | "Oppdaterte du knowledge-artifacts samme PR?" | CI på PR (branch-protection required) |
| **4. Post-merge** | `pm-merge-verification.yml` (15 min etter merge) + ukentlige audits (`cross-knowledge-audit-weekly`, `skill-freshness-weekly`, `doc-freshness`) | "Brøt noe siste 15 min / siste uke?" | Observasjon (lager issue, blokkerer ikke) |

### Hva som er load-bearing vs polish

**Load-bearing (kan ikke fjernes uten å re-introdusere kjent risiko):**

- `pm-checkpoint.sh` — adresserer 2026-05-10-mønsteret (hoppe over eldre handoffs)
- `knowledge-protocol-gate.yml` — krever skill+PITFALLS+AGENT_EXECUTION_LOG-update i samme PR
- `bug-resurrection-check.yml` — fanger reintroduksjon av tidligere fiksede bugs
- `pitfalls-id-validate.yml` — teknisk invariant (unike ID-er)
- `skill-mapping-validate.yml` — teknisk invariant (alle skills må ha scope-header)
- `preview-pages-immutable.yml` — adresserer to konkrete hendelser hvor mockups ble overskrevet
- `pm-merge-verification.yml` — fanger rødt main innen 15 min

**Polish (kan vurderes for konsolidering):**

- `skill-freshness-pr-check.yml` — informasjons-kommentar, blokkerer ikke
- `skill-freshness-weekly.yml` — kunne smelte inn i `cross-knowledge-audit-weekly`
- `doc-freshness.yml` — kunne smelte inn i `cross-knowledge-audit-weekly`
- `delta-report-gate.yml` — overlapper delvis med `knowledge-protocol-gate` (samme pilot-path-detection)

**Ikke håndhevet (honor-system):**

- `AGENT_TASK_CONTRACT.md` — genereres via script, limes inn i prompt, men ingen sjekk på commit-tid at den ble brukt eller fulgt
- `AGENT_DELIVERY_REPORT_TEMPLATE.md` — PM eyeballer 8 seksjoner manuelt under press
- `pm-knowledge-continuity.mjs --confirm-self-test` — fritekst uten paraphrase-heuristikk (i motsetning til Tier-3 fragility som har 48 tester)
- `SKILL_DOC_PROTOCOL_TEMPLATE.md` "alltid lim inn" — ingen sjekk verifiserer at agent-prompten faktisk inneholdt det

### Konsolideringskriterier (når vi skal slå sammen lag)

Vi vurderer **konsolidering** av en gate hvis ett av disse treffer:

| Kriterium | Terskel | Tolkning |
|---|---|---|
| **Bypass-frekvens for høy** | > 20% av PR-er bruker bypass på samme gate i 30 dager | Gate er for streng eller har feil scope |
| **Bypass-frekvens for lav** | 0% bypass + 0 blokkeringer i 60 dager | Gate fanger ingenting reelt |
| **Process-commit-andel** | > 30% av commits er prosess/knowledge i 60 dager | Vi bygger prosess på bekostning av produkt |
| **PM-onboarding-tid** | > 4 timer ren lesing for ny PM | Bærekraften brytes; ny PM vil hoppe over uansett |
| **Gate-overlap** | To gates fanger samme feilmodus i ≥ 80% av tilfeller | Konsolider til én med rikere bypass-policy |

Når et kriterium treffer: åpne ny ADR som vurderer konsolidering eller fjerning av spesifikk gate. **Ingen automatisk fjerning** — beslutninger skal være eksplisitte.

### Bypass-policy

Bypass er **akseptabel** når:

- **P0/P1 active customer impact** — se [`INCIDENT_MODE_VS_KNOWLEDGE_PROTOCOL.md`](../operations/INCIDENT_MODE_VS_KNOWLEDGE_PROTOCOL.md) for prioritets-rekkefølge
- **CI-bot / Dependabot / auto-doc-workflows** — mekaniske endringer uten menneskelig vurdering
- **Docs-only PR-er** — kun `docs/`-paths rørt; ingen kode-scope
- **Tobias som single owner** med eksplisitt rasjonale i PR-body

Bypass er **ikke akseptabel** når:

- Bare for å spare tid på pilot-scope-arbeid
- For å unngå skill+PITFALLS+AGENT_EXECUTION_LOG-update når task faller under §2.19 IMMUTABLE
- Som default — bypass skal være unntak, ikke standard
- Med `[bypass-knowledge-protocol]` uten konkret incident-referanse

**Konkret sikkerhetsfeil adressert i samme PR som denne ADR-en:**

`auto-generate-docs.yml` hadde hardkodet `gate-confirmed: 3dc25314e3df` på linje 97. Denne hashen kunne kopieres av hvem som helst og brukes som universal bypass på vilkårlig PR. Erstattet med `gate-not-applicable: ci-bot` (verifiseres mot PR-author `github-actions[bot]` i `pm-gate-enforcement.yml` linje 170-175).

### Bypass-telemetri (planlagt, ikke implementert i denne ADR-en)

Mål: synlig data om bypass-mønstre, ikke bare prosent.

Følge-arbeid:

- Ny script `scripts/bypass-telemetry.mjs` som leser GH API og produserer ukentlig rapport
- Wire som steg i `cross-knowledge-audit-weekly.yml`
- Rapport-output: antall bypass per gate / per uke / per begrunnelse

Ikke implementert i denne PR-en for å holde scope tett.

## Konsekvenser

### Positive

- Eksplisitt rasjonale for hvorfor systemet ser slik ut — ny PM får arkitektur-kontekst, ikke bare "slik gjør vi det"
- Konkrete trigger-kriterier som forhindrer "prosess for prosessens skyld"
- Bypass-policy gjør bypass bevisst, ikke vilkårlig
- Fjerner én konkret sikkerhetsfeil (evergreen bypass-hash)
- Setter forventning om at telemetri kommer (forhindrer drift)

### Negative

- Krever oppfølging — telemetri-scriptet må faktisk bygges, ellers blir kriteriene aspirasjonelle
- ADR-en tar plass og kan brukes til å rettferdiggjøre eksisterende system selv når kriteriene treffer
- Skaper forventning om at bypass-mønstre skal monitoreres, men aktiv oppfølging er manuell inntil telemetri er på plass

### Nøytrale

- Ingen kode-endring som påvirker prod
- Endrer ikke eksisterende gates; dokumenterer dem og setter konsolideringsregler
- Reduserer ikke onboarding-byrde direkte (kun setter forventning om at den skal måles)

## Alternativer vurdert

### Alternativ A: Konsolider til 2 lag (pre-commit + PR-merge)

**Beskrivelse:** Slå sammen onboarding-gate inn i pre-commit, og post-merge inn i PR-merge.

**Hvorfor ikke valgt:** Taper granularitet i bypass-policy. Onboarding-gate har 7-dagers TTL og er per-PM; pre-commit er per-commit. De har forskjellige tids-horisonter og bypass-criteria. Konsolidering ville tvinge ensartet policy som ikke matcher realiteten.

### Alternativ B: Bygg runtime write-scope enforcement

**Beskrivelse:** Restrict agentens write-tilgang på tool-nivå (ikke bare prompt) slik at en agent IKKE kan skrive utenfor `files_in_scope` selv om den prøver.

**Hvorfor utsatt:** Kompleksitet høy (krever sandboxed agent-runtime). Verdi-til-kost-ratio uklar uten data om hvor ofte agenter faktisk skriver utenfor scope. Vurder igjen etter at bypass-telemetri er på plass.

### Alternativ C: Slip alle gates til honor-system

**Beskrivelse:** Fjern teknisk håndhevelse helt; stol på PM/agent-disiplin.

**Hvorfor ikke valgt:** 2026-04-19-mønsteret (overskrev live med eldre branch) viste at honor-system ikke holder under press. Defense-in-depth er reell verdi.

### Alternativ D: Embedded enforcement via Claude Code tool-restriksjon

**Beskrivelse:** Bruk Claude Codes egne mekanismer (permissions, hooks) for å håndheve agent-contract direkte.

**Hvorfor utsatt:** Avhenger av plattform-features som kan endres uten varsel. For lav portability. Vurder igjen hvis stabil API tilbys.

## Implementasjon

Endringer i denne ADR-en (samme PR):

- `docs/adr/0024-pm-knowledge-enforcement-architecture.md` — denne filen (ny)
- `docs/adr/README.md` — legg til 0024 i katalog-tabellen
- `docs/operations/INCIDENT_MODE_VS_KNOWLEDGE_PROTOCOL.md` — eksplisitt prioritets-rekkefølge ved P1 (ny fil)
- `.github/workflows/auto-generate-docs.yml` — fjern evergreen `gate-confirmed: 3dc25314e3df`, erstatt med `gate-not-applicable: ci-bot`
- `docs/operations/EMERGENCY_RUNBOOK.md` — gjør telefon-placeholders mer synlige + cross-ref til `INCIDENT_MODE_VS_KNOWLEDGE_PROTOCOL.md`
- `docs/operations/STAKEHOLDERS.md` — gjør placeholders synlige med TODO-banner
- `docs/engineering/AGENT_TASK_CONTRACT.md` — cross-ref til `INCIDENT_MODE_VS_KNOWLEDGE_PROTOCOL.md` for når kontrakt ikke gjelder

Følge-PR-er (ikke i denne):

- `scripts/bypass-telemetry.mjs` — ukentlig rapport via `cross-knowledge-audit-weekly.yml`
- Skill-SHA-lockfile i `generate-agent-contract.sh` (Fase 2)
- Persistent evidence-storage i `docs/evidence/` (Fase 2)
- `scripts/validate-delivery-report.mjs` + CI-gate (Fase 3)
- Server-side checkpoint-signering med OIDC (Fase 3)

## Referanser

- `docs/engineering/PM_ONBOARDING_PLAYBOOK.md` §2 + §3 (4-lags-system beskrivelse)
- `docs/engineering/KNOWLEDGE_CONTROL_PRELOCK_REVIEW_2026-05-15.md` (selvkritisk gjennomgang)
- `docs/engineering/KNOWLEDGE_AUTONOMY_PROTOCOL.md` §3 (markerer hva som er 🟡 TODO)
- `docs/engineering/PITFALLS_LOG.md` §11 (agent-orkestrering-fallgruver)
- `docs/engineering/AGENT_TASK_CONTRACT.md` (fact-bound contract-flyt)
- `docs/operations/EMERGENCY_RUNBOOK.md` (P1-prosedyrer)
- `docs/operations/INCIDENT_MODE_VS_KNOWLEDGE_PROTOCOL.md` (denne PR-en — prioritets-rekkefølge)
- `.claude/skills/pm-orchestration-pattern/SKILL.md` v1.3.4
- Relaterte ADR-er: [0009](./0009-pm-centralized-git-flow.md) (PM-sentralisert git-flyt), [0010](./0010-done-policy-legacy-avkobling.md) (Done-policy)
