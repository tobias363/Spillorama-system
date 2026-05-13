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

## Knowledge protocol (Tobias-direktiv 2026-05-13)

Hvis denne PR-en rør pilot-relatert kode (Spill 1/2/3, master-flow, buy-popup, ticket-grid, payout, wallet), bekreft minst ett av disse:

- [ ] **PITFALLS_LOG.md** oppdatert ELLER ingen ny fallgruve oppdaget
- [ ] **PM_HANDOFF_YYYY-MM-DD.md** utkast skrevet ELLER ikke sesjons-slutt
- [ ] **Relevant skill** under `.claude/skills/` oppdatert ELLER ikke generaliserbart mønster
- [ ] **AGENT_EXECUTION_LOG.md** appended hvis denne PR-en kommer fra en agent-leveranse

### FRAGILITY-comprehension (Tier-3, etablert 2026-05-13)

Hvis commits i denne PR-en har `[context-read: F-NN]`-tagger, bekreft:

- [ ] Hver `[context-read: F-NN]`-tag har en tilhørende `## Comprehension`-blokk i commit-message som paraphraserer entry-en (filer + ≥ 1 regel fra "Hva ALDRI gjøre")
- [ ] Eventuelle `[comprehension-bypass: ...]`-bruk er forklart i PR-beskrivelsen og minst 20 tegn lang

Se [`docs/engineering/COMPREHENSION_VERIFICATION.md`](../docs/engineering/COMPREHENSION_VERIFICATION.md) for detaljer. Håndheves automatisk av `.husky/pre-commit-comprehension.sh`.

## Tracking
- Linear issue: 
- Release note entry:
- Screenshots/video (if UI change):
