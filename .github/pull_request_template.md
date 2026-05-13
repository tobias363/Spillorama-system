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
gate-bypass: <begrunnelse>         # Eksplisitt bypass m/Tobias-godkjenning
gate-not-applicable: <rolle>       # Tobias selv / docs-only / dependabot / ci-bot
-->

## Knowledge protocol

> Tobias-direktiv 2026-05-13. Gjelder pilot-relatert kode (Spill 1/2/3, master-flow, buy-popup, ticket-grid, payout, wallet).

**Post-work-disiplin** — bekreft minst ett:

- [ ] `PITFALLS_LOG.md` oppdatert ELLER ingen ny fallgruve oppdaget
- [ ] `PM_HANDOFF_YYYY-MM-DD.md`-utkast skrevet ELLER ikke sesjons-slutt
- [ ] Relevant skill under `.claude/skills/` oppdatert ELLER ikke generaliserbart mønster
- [ ] `AGENT_EXECUTION_LOG.md` appended hvis denne PR-en kommer fra agent-leveranse

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

## Tracking

- Linear issue:
- Release note entry:
- Screenshots/video (hvis UI-endring):
