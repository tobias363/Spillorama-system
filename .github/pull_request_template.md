## PM-onboarding-bekreftelse (mandatory for PM-AI)

> Velg **én** av de tre boksene under. Hvis du er PM-AI som koordinerer prosjektet på toppen,
> har du forbud mot å åpne PR uten passert onboarding-gate. Se `CLAUDE.md` topp-blokk og
> `docs/engineering/PM_ONBOARDING_PLAYBOOK.md` §3 for detaljer.

- [ ] **Jeg er PM-AI** og `bash scripts/pm-checkpoint.sh --validate` returnerte exit 0 før første
  kode-handling i denne sesjonen. Main-SHA i `.pm-onboarding-confirmed.txt`: `__paste_sha_here__`
- [ ] **Jeg er en agent under PM-koordinering** (PM-AI har spawnet meg) og PM har bekreftet at
  onboarding-gate er passert.
- [ ] **Jeg er ikke PM** (Tobias / ekstern utvikler / Dependabot / annet). Onboarding-gate
  gjelder ikke for meg.

<!--
  PM-Gate Workflow Marker (verifiseres av .github/workflows/pm-gate-enforcement.yml)

  Workflow-en aksepterer ETT av:
    - Checkbox over m/faktisk SHA (BIN-PM-VT-format)
    - gate-confirmed: <hash-prefix>      # 12-tegn-hash fra docs/.pm-confirmations.log
    - gate-bypass: <begrunnelse>         # Eksplisitt bypass m/Tobias-godkjenning
    - gate-not-applicable: <rolle>       # Tobias selv / docs-only / dependabot / ci-bot

  Detaljer: docs/operations/PM_PR_VERIFICATION_DUTY.md
-->

<!-- valgfritt for kortform: gate-confirmed: __hash_or_remove__ -->

## Summary
- 

## Scope
- [ ] apps/backend
- [ ] apps/admin-web
- [ ] packages/game-client
- [ ] packages/shared-types
- [ ] DevOps/CI
- [ ] docs/

## Risk
- [ ] Low
- [ ] Medium
- [ ] High

## Testing
- [ ] `npm --prefix apps/backend run check`
- [ ] `npm --prefix apps/backend run test`
- [ ] `npm --prefix apps/backend run test:compliance`
- [ ] `npm --prefix apps/backend run build`
- [ ] Manual verification completed

## Deploy Plan
- Render environment: `staging` / `production`
- Health endpoint checked: `/health`
- Rollback plan:

## Done-policy

Before marking a Linear issue **Done**, all three must be true:

- [ ] Commit-SHA is **merged to `main`** (not only on a feature-branch). Paste the merge commit SHA in the closing comment.
- [ ] Exact `file:line` reference (`apps/backend/...`, `packages/...`) is in the issue comment, proving the change.
- [ ] Test that verifies the behaviour is green in CI (link to CI run if possible).

"Implemented on feature-branch" is **NOT** Done. See [docs/engineering/ENGINEERING_WORKFLOW.md §7](../docs/engineering/ENGINEERING_WORKFLOW.md#7-legacy-avkobling-done-policy) for the full policy.

## Architecture Decision Records (ADR)

- [ ] Hvis denne PR-en tar en beslutning som påvirker ≥ 2 agenter eller services, har en ADR blitt opprettet i `docs/adr/`? (N/A for ren bug-fix, polish, eller implementasjon av eksisterende ADR. Se `docs/adr/README.md` for når ADR kreves.)

## Knowledge protocol (mandatory for pilot-relatert kode)

Tobias-direktiv 2026-05-13: "Vi må tilegne oss kunnskap og dokumentere slik at denne kunnskapen ikke er tapt med ny PM og agenter."

Hvis PR-en rører pilot-relatert kode (Spill 1/2/3, master-flow, buy-popup, ticket-grid, payout, agent-portal, room-state), kryss av alle tre:

- [ ] **PITFALLS_LOG oppdatert** ELLER ingen ny fallgruve oppdaget i denne PR-en
- [ ] **PM_HANDOFF utkast skrevet** (`docs/operations/PM_HANDOFF_YYYY-MM-DD.md`) ELLER dette er ikke sesjons-slutt
- [ ] **Relevant skill oppdatert** (`.claude/skills/<name>/SKILL.md` ELLER tilsvarende doc i `docs/engineering/`) ELLER mønsteret er ikke generaliserbart

For ikke-pilot-PR (rene docs, dependabot, infra-tweaks): kryss av denne i stedet:

- [ ] **Knowledge protocol N/A** — PR-en rører ikke pilot-relatert kode

Håndhevelse: `.github/workflows/knowledge-protocol-gate.yml` blokkerer PR hvis pilot-kode endret uten utfylt seksjon.

Se [`docs/engineering/PILOT_TEST_FLOW_AND_KNOWLEDGE_PROTOCOL.md`](../docs/engineering/PILOT_TEST_FLOW_AND_KNOWLEDGE_PROTOCOL.md) for full protokoll.

## Tracking
- Linear issue: 
- Release note entry:
- Screenshots/video (if UI change):
