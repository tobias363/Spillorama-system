## Summary

<!-- 1-3 sentninger: hva endrer denne PR-en og hvorfor? -->
-

## Scope

- [ ] apps/backend
- [ ] apps/admin-web
- [ ] packages/game-client
- [ ] packages/shared-types
- [ ] DevOps / CI
- [ ] docs/

## Risk

- [ ] Low
- [ ] Medium
- [ ] High

## PM-gate marker

> Velg **én**. Detaljer: [`docs/operations/PM_PR_VERIFICATION_DUTY.md`](../docs/operations/PM_PR_VERIFICATION_DUTY.md). Workflow: `.github/workflows/pm-gate-enforcement.yml`.

- [ ] **PM-AI** — `bash scripts/pm-checkpoint.sh --validate` returnerte exit 0. Main-SHA i `.pm-onboarding-confirmed.txt`: `__paste_sha_here__`
- [ ] **Agent under PM-koordinering** — PM har bekreftet at onboarding-gate er passert
- [ ] **Ikke PM** (Tobias / ekstern utvikler / Dependabot) — onboarding-gate gjelder ikke

<!-- Kortform-alternativer (workflow aksepterer disse i stedet for checkbox):
gate-confirmed: <hash-prefix>      # 12-tegn-hash fra docs/.pm-confirmations.log
gate-bypass: <begrunnelse>         # Krever label approved-pm-bypass
gate-not-applicable: <rolle>       # docs-only/dependabot/ci-bot/tobias; andre krever approved-pm-bypass
-->

## Knowledge protocol

> Tobias-direktiv 2026-05-13. Gjelder pilot-relatert kode (Spill 1/2/3, master-flow, buy-popup, ticket-grid, payout, wallet).

**Agent contract** — for agent-leveranser paa high-risk kode:

- [ ] PM genererte fact-bound agent-kontrakt med `npm run agent:contract -- ...` ELLER dette er ikke agent-leveranse/high-risk scope
- [ ] Agent Delivery Report mottatt og sjekket mot `docs/engineering/AGENT_DELIVERY_REPORT_TEMPLATE.md` ELLER ikke relevant
- [ ] Agentens root-cause-forklaring peker til konkret evidence (file:line, DB-rad, logglinje, Sentry/PostHog, test-output) ELLER docs-only

**Post-work-disiplin** — for pilot/wallet/compliance-kode håndhever `.github/workflows/knowledge-protocol-gate.yml` at alle tre kunnskapsartefakter oppdateres:

- [ ] `PITFALLS_LOG.md` oppdatert ELLER ingen ny fallgruve oppdaget
- [ ] Relevant skill under `.claude/skills/` oppdatert ELLER ikke generaliserbart mønster
- [ ] `AGENT_EXECUTION_LOG.md` appended hvis denne PR-en kommer fra agent-leveranse
- [ ] `PM_HANDOFF_YYYY-MM-DD.md`-utkast skrevet ELLER ikke sesjons-slutt

<!-- Knowledge-protocol bypass er sjelden og krever label approved-knowledge-bypass:
[bypass-knowledge-protocol: <begrunnelse>]
knowledge-not-applicable: <begrunnelse>
-->

**Delta-rapport** — kreves når pilot-kode endres (`docs/delta/YYYY-MM-DD-<branch>.md`). Workflow: `.github/workflows/delta-report-gate.yml`. Bypass-marker (sjelden):

```
[bypass-delta-report: <begrunnelse>]
```

**FRAGILITY-comprehension** — hvis commits har `[context-read: F-NN]`-tagger:

- [ ] Hver tag har tilhørende `## Comprehension`-blokk i commit-message (≥ 1 regel fra "Hva ALDRI gjøre")
- [ ] Eventuelle `[comprehension-bypass: ...]` er forklart i PR-beskrivelsen (≥ 20 tegn)

Detaljer: [`docs/engineering/COMPREHENSION_VERIFICATION.md`](../docs/engineering/COMPREHENSION_VERIFICATION.md).

**Bug-resurrection** — workflow blokkerer hvis endrede linjer SIST ble endret av `fix(...)`-commit innen 30 dager uten ack. Velg én hvis applicable:

- [ ] Ingen overlap (detector vil gi grønt)
- [ ] Acknowledged i commit-melding (`[resurrection-acknowledged: <grunn>]`)
- [ ] Acknowledged her: <!-- Resurrection acknowledged: <forklar overlap og hvorfor intensjonell> -->

<!-- Emergency-bypass (sjelden, krever Tobias-godkjenning):
resurrection-bypass: <begrunnelse>
resurrection-not-applicable: <rolle>      # docs-only / dependabot / ci-bot
-->

Detaljer: [`docs/engineering/BUG_RESURRECTION_DETECTOR.md`](../docs/engineering/BUG_RESURRECTION_DETECTOR.md).

## Architecture Decision Records (ADR)

- [ ] Hvis denne PR-en tar en beslutning som påvirker ≥ 2 agenter eller services, er en ADR opprettet i `docs/adr/`? (N/A for ren bug-fix, polish, eller implementasjon av eksisterende ADR. Se [`docs/adr/README.md`](../docs/adr/README.md).)

## MCP write-access (ADR-0023)

- [ ] **Ingen direct MCP-write mot prod-DB i denne PR-en.** All schema-/data-korreksjon i prod går via migration-PR (forward-only). Lokal dev-DB kan bruke write-capable MCP. Se [ADR-0023](../docs/adr/0023-mcp-write-access-policy.md).

## Testing

- [ ] `npm --prefix apps/backend run check`
- [ ] `npm --prefix apps/backend run test`
- [ ] `npm --prefix apps/backend run test:compliance`
- [ ] `npm --prefix apps/backend run build`
- [ ] Manuell verifikasjon utført

<!-- 🎯 Tobias smoke-test auto-genereres av .github/workflows/ai-fragility-review.yml som
     PR-kommentar etter opprettelse. Hvis scenariet ikke passer, legg en eksplisitt
     "Smoke-test"-seksjon under. Format-spec: docs/engineering/TOBIAS_READINESS_FORMAT.md -->

## Deploy Plan

- Render environment: `staging` / `production`
- Health endpoint: `/health`
- Rollback plan:

## Done-policy

Før Linear-issue markeres **Done**, alle tre må være sanne:

- [ ] Commit-SHA er **merget til `main`** (ikke kun feature-branch). Lim inn merge-commit-SHA i closing comment.
- [ ] `file:line`-referanse (`apps/backend/...`, `packages/...`) i issue-kommentar dokumenterer endringen.
- [ ] Test som verifiserer atferd er grønn i CI (link til CI-run hvis mulig).

"Implementert på feature-branch" er **IKKE** Done. Se [`docs/engineering/ENGINEERING_WORKFLOW.md §7`](../docs/engineering/ENGINEERING_WORKFLOW.md#7-legacy-avkobling-done-policy).

---

"Implemented on feature-branch" is **NOT** Done. See [docs/engineering/ENGINEERING_WORKFLOW.md §7](../docs/engineering/ENGINEERING_WORKFLOW.md#7-legacy-avkobling-done-policy) for the full policy.

## Architecture Decision Records (ADR)

- [ ] Hvis denne PR-en tar en beslutning som påvirker ≥ 2 agenter eller services, har en ADR blitt opprettet i `docs/adr/`? (N/A for ren bug-fix, polish, eller implementasjon av eksisterende ADR. Se `docs/adr/README.md` for når ADR kreves.)

## Bug-resurrection acknowledgment

> Detektor: `.github/workflows/bug-resurrection-check.yml` blokkerer merge hvis PR'en endrer
> linjer som SIST ble endret av en `fix(...)`-commit innen 30 dager — uten at minst én
> commit-melding ELLER PR-body inneholder acknowledgment. Se
> [`docs/engineering/BUG_RESURRECTION_DETECTOR.md`](../docs/engineering/BUG_RESURRECTION_DETECTOR.md).
>
> Velg én hvis applicable. Hvis ingen, la stå.

- [ ] **Ingen overlap** — PR'en touch'er ingen recent-fix-regioner (detector vil gi grønt)
- [ ] **Acknowledged i commit** — minst én commit har `[resurrection-acknowledged: <grunn>]` i meldingen
- [ ] **Acknowledged her** — fyll inn under hvis du vil acknowledge på PR-nivå

<!-- Hvis acknowledged her, fjern kommentar-markøren under og fyll inn grunn -->
<!-- Resurrection acknowledged: <forklar hvilken recent fix dette overlapper med og hvorfor endringen er intensjonell> -->

<!-- Emergency-bypass (sjelden, krever Tobias-godkjenning) -->
<!-- resurrection-bypass: <begrunnelse> -->

<!-- Docs-only / dependabot / ci-bot — gjelder ikke for kode-endringer -->
<!-- resurrection-not-applicable: <rolle> -->

---

## Knowledge protocol (Tobias-direktiv 2026-05-13)

Hvis denne PR-en rør pilot-relatert kode (Spill 1/2/3, master-flow, buy-popup, ticket-grid, payout, wallet), bekreft minst ett av disse:

- [ ] **PITFALLS_LOG.md** oppdatert ELLER ingen ny fallgruve oppdaget
- [ ] **FRAGILITY_LOG.md** F-NN-entries lest for endrede filer ELLER ingen FRAGILITY-flagget fil endret
- [ ] **PM_HANDOFF_YYYY-MM-DD.md** utkast skrevet ELLER ikke sesjons-slutt
- [ ] **Relevant `SKILL.md`** under `.claude/skills/*/` oppdatert hvis generaliserbart mønster lært ELLER ikke generaliserbart
- [ ] **AGENT_EXECUTION_LOG.md** appended hvis denne PR-en kommer fra en agent-leveranse

### FRAGILITY-comprehension (Tier-3, etablert 2026-05-13)

Hvis commits i denne PR-en har `[context-read: F-NN]`-tagger, bekreft:

- [ ] Hver `[context-read: F-NN]`-tag har en tilhørende `## Comprehension`-blokk i commit-message som paraphraserer entry-en (filer + ≥ 1 regel fra "Hva ALDRI gjøre")
- [ ] Eventuelle `[comprehension-bypass: ...]`-bruk er forklart i PR-beskrivelsen og minst 20 tegn lang

Se [`docs/engineering/COMPREHENSION_VERIFICATION.md`](../docs/engineering/COMPREHENSION_VERIFICATION.md) for detaljer. Håndheves automatisk av `.husky/pre-commit-comprehension.sh`.

## Agent Contract (pre-spawn evidence — Fase A av ADR-0024)

Hvis denne PR-en kommer fra en agent-leveranse på **high-risk paths** (apps/backend/src/game/, wallet/, compliance/, draw-engine/, sockets/, packages/game-client/games/, packages/shared-types/, apps/admin-web cash-inout/agent-portal, agent/admin game-routes), fyll inn:

```
Contract-ID: <YYYYMMDD-slug>
Contract-path: docs/evidence/<YYYYMMDD-slug>/contract.md
```

Krav:
- Contract-path må peke til en faktisk committed fil i denne PR-en
- Contract-ID må matche katalog-navnet i Contract-path
- Contract-filen skal inneholde agent-kontrakten brukt **før** agent startet arbeid

**Generér med:** `bash scripts/pm-spawn-agent.sh --agent "..." --objective "..." --files ... --risk P0`

**Bypass (kun for non-agent-spawned PR-er):**

```
[agent-contract-not-applicable: <begrunnelse min 20 tegn>]
```

Gyldige bypass-scenarier:
- PR er ikke agent-spawnet (Tobias/PM committet direkte)
- Endringen er for liten til at agent-contract er relevant

For ikke-trivielle bypass: legg label `approved-agent-contract-bypass`.

Håndheves av [`.github/workflows/agent-contract-gate.yml`](../.github/workflows/agent-contract-gate.yml). **Shadow-mode 2026-05-16 → 2026-05-23**; hard-fail tidligst 2026-05-24 (se ADR-0024 endrings-log for flip-dato). Layered defense — komplementært til knowledge-protocol/delivery-report/delta-report som sjekker POST-delivery, mens agent-contract sjekker PRE-spawn.

## Tracking

- Linear issue:
- Release note entry:
- Screenshots/video (hvis UI-endring):
