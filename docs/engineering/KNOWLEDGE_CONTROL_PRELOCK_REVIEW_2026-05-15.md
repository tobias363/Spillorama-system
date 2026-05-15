# Knowledge Control Pre-lock Review — 2026-05-15

**Status:** Pre-lock review etter executive-brief gjennomgang.
**Eier:** PM-AI / Tobias Haugen.
**Formål:** Lukke gap mellom dokumentert kunnskapsmodell og faktisk repo-/CI-håndheving før systemet omtales som låst v1.

---

## Konklusjon

Kunnskapsdelingssystemet har solid fundament, men var ikke låsbart før denne runden fordi flere claims var sterkere enn faktisk håndheving:

- PM-checkpoint leste ikke arkiverte `PM_HANDOFF_*.md`.
- `pm-doc-absorption-gate.sh` var dokumentert som hard-block, men manglet.
- `knowledge-protocol-gate.yml` var dokumentert, men manglet som workflow.
- `gate-bypass:` var informativt, ikke godkjenningsstyrt.
- `PITFALLS_LOG.md` hadde duplikate §-ID-er.

Denne runden lukker de repo-interne kontrollgapene over og dokumenterer
access-/approval-matrisen. GitHub branch protection er auditert direkte
mot `main` 2026-05-15. Ekstern evidens må fortsatt hentes for alert
policy, prod/staging-topologi, RTO/RPO og compliance-vurderinger.

---

## Kontrollmatrise

| Risiko | Kontroll | Håndheving | Evidens |
|---|---|---|---|
| Ny PM mangler historisk kontekst | PM-checkpoint dekker aktive + arkiverte handoffs | `scripts/pm-checkpoint.sh` + `scripts/check-pm-gate.mjs` + pre-commit/PR-gate | `.pm-onboarding-confirmed.txt`, `docs/.pm-confirmations.log` |
| Ny PM har lest handoffs men ikke ADR/skills/pitfalls | Doc-absorpsjon-gate | `scripts/pm-doc-absorption-gate.sh --validate` | `.pm-doc-absorption-confirmed.txt` |
| Agent fikser kode uten å bevare læring | Knowledge protocol gate | `.github/workflows/knowledge-protocol-gate.yml` | PR diff må ha `PITFALLS_LOG.md`, `AGENT_EXECUTION_LOG.md`, relevant `SKILL.md` |
| Bypass brukes uten ansvarlig godkjenning | Label-gated bypass | `.github/workflows/pm-gate-enforcement.yml` | `approved-pm-bypass` eller automatisk verifisert rolle |
| Fallgruve-ID-er kolliderer og agenter leser feil entry | Unique PITFALLS IDs | `scripts/check-pitfalls-ids.mjs` + `.github/workflows/pitfalls-id-validate.yml` | CI-logg + grønn validator |
| Live-test kjøres uten observability | Monitor/Sentry/PostHog/DB-prosedyre | Foreløpig runbook/checklist, ikke full CI-gate | Må lukkes i neste runde med guarded pilot-test command |
| Required reviews aktiveres uten reell approver | Access/approval-matrise med lock-kriterier | `docs/operations/ACCESS_APPROVAL_MATRIX.md` + CODEOWNERS-note | Reviews holdes av til uavhengig approver finnes |

---

## Branch protection audit — `main` 2026-05-15

Direkte GitHub API-audit via `gh api repos/tobias363/Spillorama-system/branches/main/protection` under konto `tobias363`:

| Kontroll | Faktisk status | Lock-vurdering |
|---|---|---|
| `main` protected | Ja | OK |
| Required checks | `backend`, `compliance`, `lint-blink-hazards`, `admin-web`, `pm-gate-enforcement`, `knowledge-protocol-enforcement`, `pitfalls-id-validation` | OK |
| Strict status checks | På | OK |
| Required PR reviews | Ikke konfigurert | Bevisst utsatt: repoet har kun én reell approver (`tobias363`) |
| Admin enforcement | På | OK, med emergency-policy i `ACCESS_APPROVAL_MATRIX.md` |
| Force pushes | Av | OK |
| Branch deletions | Av | OK |
| Linear history | Av | Akseptabelt, men kan vurderes etter merge-strategi |
| Push restrictions | Ingen | Bør vurderes hvis flere eksterne devs får write access |

Minimumsanbefaling før required reviews aktiveres:

- Onboard minst én uavhengig approver og dokumenter vedkommende i `ACCESS_APPROVAL_MATRIX.md` §7.
- Oppdater CODEOWNERS fra single-owner `@tobias363` til team/rolle-handles eller konkrete backup-approvers.
- Test hotfix-flow med branch protection aktiv, inkludert emergency-labels og post-merge-review.
- Aktiver deretter 1 approving review, dismiss stale approvals, code-owner review for high-risk paths og conversation resolution.

---

## Åpne eksterne evidens-punkter før endelig lock

1. Sentry/PostHog: prod/staging-prosjekter, P0/P1-thresholds, varslingskanaler, release-blocker-regler.
2. Prod/staging-topologi: Render services, DB/Redis, deploy-flow, kritiske env-navn uten verdier.
3. RTO/RPO: særskilt 0-datatap for wallet/audit.
4. Uavhengig approver-roster: navn/konto for wallet, compliance, live-room engine og DevOps.
5. Siste compliance-/juridiske vurdering: dato, krav/paragrafer, åpne spørsmål.

---

## Neste anbefalte lock-kriterium

Systemet kan låses som **Knowledge-control framework v1** når:

- Required checks er grønne på `main`.
- `approved-pm-bypass`, `approved-knowledge-bypass`, `approved-emergency-merge` og `post-merge-review-required` finnes som GitHub labels med Tobias/CODEOWNER-eierskap.
- Branch protection beholder strict checks og admin enforcement.
- Required reviews aktiveres først etter §7-roster er fylt ut.
- Pilot-test får en guarded wrapper som verifiserer monitor + Sentry/PostHog + DB-watch før test.
