# Access & Approval Matrix

**Sist oppdatert:** 2026-05-15
**Eier:** Tobias Haugen (technical lead)
**Status:** Aktiv kontroll for GitHub, deploy, observability og nød-bypass

Dette dokumentet er den kanoniske kilden for hvem som kan lese, endre,
godkjenne, merge, deploye og bypasse kontroller i Spillorama-systemet.
Det utfyller [`CREDENTIALS_AND_ACCESS.md`](./CREDENTIALS_AND_ACCESS.md),
som kun beskriver hvor credentials ligger og hvordan de roteres.

Målet er ikke mer prosess. Målet er at live-rom med ekte penger aldri
endres gjennom uklare roller, uformelle godkjenninger eller "alle trodde
noen andre hadde sjekket"-situasjoner.

---

## 1. Faktisk GitHub-state per 2026-05-15

Direkte audit med `gh api 'repos/tobias363/Spillorama-system/collaborators?affiliation=all'`:

| Konto | Rolle | Effektiv tilgang | Bruk |
|---|---|---|---|
| `tobias363` | Admin | Full repo-admin, branch-protection, labels, secrets, merge | Tobias' autoritative GitHub-konto |
| `tobias50` | Write | Push/PR/write, ikke admin | Sekundær/legacy-konto, ikke uavhengig reviewer |

**Konsekvens:** Required PR reviews skal ikke aktiveres ennå. Med bare
én faktisk ansvarlig admin/reviewer gir required reviews enten falsk
trygghet eller lockout. Før review-krav aktiveres må minst én navngitt,
uavhengig approver være onboardet og dokumentert i §7.

Branch protection per 2026-05-15:

| Kontroll | Status |
|---|---|
| `main` protected | Ja |
| Required checks | `backend`, `compliance`, `lint-blink-hazards`, `admin-web`, `pm-gate-enforcement`, `knowledge-protocol-enforcement`, `pitfalls-id-validation` |
| Strict status checks | På |
| Admin enforcement | På |
| Required PR reviews | Av, med eksplisitt begrunnelse over |
| Force push | Av |
| Branch deletion | Av |

---

## 2. Roller

| Rolle | Definisjon | Skal ha prod-myndighet? |
|---|---|---|
| Tobias / technical lead | Endelig ansvarlig for produkt, regulatorikk, penger og branch-protection | Ja |
| PM-AI | Koordinerer agenter, PR-er, docs, CI og merge-flyt etter Tobias-direktiv | Nei, med mindre Tobias eksplisitt gir token/tilgang |
| Implementer-agent | Skriver avgrenset kode/docs i egen branch/worktree | Nei |
| Ekstern dev | Menneskelig bidragsyter med avgrenset scope | Nei som standard |
| L2 backend on-call | Utfører incident/hotfix-prosedyre | Begrenset og tidsavgrenset |
| L3 incident commander | Incident-beslutninger og eskalering | Kan godkjenne hotfix sammen med Tobias |
| Compliance/juridisk | Vurderer pengespillforskriften, Lotteritilsynet og meldeplikt | Godkjenner compliance-endringer, ikke teknisk merge alene |
| CI-bot / GitHub Actions | Kjører tester, gates og deploy-integrasjoner | Maskinell deploy etter grønn kontroll |
| Support/hall-operator | Observerer pilot, melder feil, utfører hall-operasjoner | Nei |

---

## 3. System-tilgangsmatrise

| System/kapabilitet | Tobias | PM-AI | Implementer-agent | Ekstern dev | CI-bot | L2/L3 | Support |
|---|---|---|---|---|---|---|---|
| GitHub repo read | Owner | Ja | Ja etter behov | Ja etter behov | Ja | Ja | Nei som standard |
| GitHub branch push | Ja | Via Tobias-token når gitt | Kun egen branch | Kun egen branch | Nei | Hotfix branch | Nei |
| Merge til `main` | Ja | Kun når token/eierskap er gitt av Tobias og checks er grønne | Nei | Nei | Auto-merge hvis konfigurert | Kun hotfix under §9 | Nei |
| Branch protection config | Ja | Nei, med mindre Tobias eksplisitt ber om endring | Nei | Nei | Nei | Nei | Nei |
| GitHub labels for bypass | Ja | Kan foreslå/apply når token er gitt, men skal loggføre | Nei | Nei | Nei | Nei | Nei |
| GitHub Actions secrets | Ja | Nei | Nei | Nei | Bruker injected secrets | Nei | Nei |
| Render prod env-vars | Ja | Read-only/operasjon etter Runbook | Nei | Nei | Runtime/deploy only | Begrenset under incident | Nei |
| Render deploy/restart | Ja | Etter direktiv | Nei | Nei | Ja via workflow/deploy hook | Under incident | Nei |
| Prod database read | Ja | Kun eksplisitt incident/audit | Nei | Nei | App-runtime only | Under incident | Nei |
| Prod database write/manual correction | Ja, men helst via script/PR | Nei uten eksplisitt Tobias-godkjenning | Nei | Nei | App-runtime/migrations only | Kun med Tobias + audit | Nei |
| Sentry/PostHog read | Ja | Ja for PM-monitorering | Nei, med mindre task krever | Nei som standard | Nei | Ja under incident | Read-only dashboard hvis delegert |
| Sentry/PostHog alert policy | Ja | Kan foreslå endringer | Nei | Nei | Nei | Kan foreslå under incident | Nei |
| Linear | Ja | Ja | Via task-lenker | Etter behov | Nei | Ja under incident | Ja for rapportering |
| 1Password/secrets vault | Ja | Kun delte entries, tidsavgrenset | Nei | Nei | Nei | Tidsavgrenset ved vakt | Nei |

**Regel:** Ingen agent eller ekstern dev får direkte prod-write. Hvis en
agent trenger prod-observasjon, skal PM/Tobias hente data og gi redigert
kontekst tilbake, eller gi tidsavgrenset read-only tilgang med audit.

---

## 4. PR-approval policy

### 4.1 Normal PR

Krav før merge til `main`:

1. PR er fra branch, ikke direkte push til `main`.
2. Required checks er grønne.
3. PR-body har PM-gate-status og knowledge-protocol-status.
4. Relevant skill, [`PITFALLS_LOG.md`](../engineering/PITFALLS_LOG.md)
   og [`AGENT_EXECUTION_LOG.md`](../engineering/AGENT_EXECUTION_LOG.md)
   er oppdatert når koden endrer atferd eller læring.
5. PM/Tobias verifiserer at endringen er innenfor scope.

### 4.2 High-risk PR

High-risk PR krever Tobias-godkjenning i PR-review eller PR-kommentar før
merge, selv om required reviews ikke er teknisk aktivert ennå.

High-risk inkluderer:

- Wallet, ledger, reservasjoner, payouts, Swedbank Pay eller KYC.
- Compliance, audit-logg, §11/§66/§71, Lotteritilsynet-rapportering.
- Live-rom engine, draw-loop, stuck-game recovery eller master-flow.
- Database migrations, schema-as-code, irreversible dataendringer.
- GitHub Actions, branch protection, PM-gates, knowledge-gates, bypass.
- Secrets, env-vars, Render prod, deploy/rollback/hotfix-runbooks.
- Sentry/PostHog alert policy og monitorering for P0/P1.

### 4.3 Docs-only PR

Docs-only kan merges med normal required-check-disiplin, men ikke hvis
docsendringen endrer autoritativ policy for:

- Compliance.
- Hotfix/incident.
- Access/approval.
- PM-gates/knowledge-gates.
- Secrets/credentials.

Slike docs er high-risk policy-endringer og følger §4.2.

---

## 5. Bypass-labels og hva de betyr

| Label | Hvem kan godkjenne? | Hva den tillater | Krav til audit |
|---|---|---|---|
| `approved-pm-bypass` | Tobias/CODEOWNER | PM-gate bypass eller `gate-not-applicable` uten automatisk rollebevis | PR-body må ha `gate-bypass:` eller `gate-not-applicable:` med konkret grunn |
| `approved-knowledge-bypass` | Tobias/CODEOWNER | Knowledge-protocol bypass/not-applicable | PR-body må ha `bypass-knowledge-protocol:` eller `knowledge-not-applicable:` |
| `approved-emergency-merge` | Tobias | Nødmerge/hotfix hvor ordinær venting er farligere enn merge | Incident/Linear-lenke, P0/P1-grunn, teststatus, etter-review |
| `post-merge-review-required` | Tobias/PM | Marker at merge var tidskritisk og må etter-revideres | Review innen 24 timer, full remediation innen 7 dager |

Bypass-label er aldri en snarvei rundt ansvar. Den er en audit-markør
som gjør unntaket synlig for neste PM, Tobias og eventuell revisjon.

---

## 6. Når required reviews kan aktiveres

Required PR reviews skal først aktiveres når alle kriterier er sanne:

1. Minst to menneskelige GitHub-kontoer er dokumentert med klare roller:
   en owner og minst én uavhengig approver.
2. CODEOWNERS er oppdatert fra bare `@tobias363` til team/rolle-handles
   eller navngitte approvers per kritisk domene.
3. Hotfix-prosessen er testet med branch protection aktiv.
4. Nød-bypass er dokumentert og audit-labels finnes.
5. En PR har demonstrert at high-risk policy kan merges uten lockout.

Anbefalt branch protection når kriteriene er møtt:

- Require 1 approving review.
- Dismiss stale approvals.
- Require review from Code Owners for high-risk paths.
- Require conversation resolution.
- Behold strict status checks og admin enforcement.

Inntil dette er sant er beste praksis å holde review-kravet av, men
praktisere Tobias-godkjenning for high-risk PR-er manuelt og synlig.

---

## 7. Approver roster

| Domene | Primær approver | Backup approver | Status |
|---|---|---|---|
| All repo / branch protection | `tobias363` | Ikke definert | Ikke låsbart for required reviews |
| Wallet / ekte penger | `tobias363` | Ikke definert | Må defineres før pilot-lock |
| Compliance / Lotteritilsynet | `tobias363` + compliance/juridisk | Ikke definert | Juridisk navn/dato må fylles inn |
| Live-rom engine | `tobias363` | Ikke definert | Må defineres før flere devs får write |
| DevOps / deploy / observability | `tobias363` | Ikke definert | Må defineres før review-krav |

**Neste organisatoriske handling:** Tobias må enten onboarde én
uavhengig teknisk approver eller eksplisitt beslutte at required reviews
forblir av frem til teamet har en reell reviewer. Denne beslutningen må
logges i neste PM-handoff.

---

## 8. Access review cadence

Kjør access-review:

- Ved hver PM-overgang.
- Ved hver ny ekstern dev/agent med repo-write.
- Etter P0/P1 incident.
- Ukentlig under pilot.
- Månedlig etter stabil drift.

Minimumskommandoer:

```bash
gh api 'repos/tobias363/Spillorama-system/collaborators?affiliation=all' \
  --jq '.[] | {login, role_name, permissions}'

gh api repos/tobias363/Spillorama-system/branches/main/protection \
  --jq '{required_status_checks, enforce_admins, required_pull_request_reviews, allow_force_pushes, allow_deletions}'

gh label list --search bypass
gh label list --search emergency
```

Resultatet skal legges i relevant PM-handoff eller audit-notat når det
endrer seg.

---

## 9. Emergency merge / hotfix policy

Emergency merge er bare lov når alle punktene under er sanne:

1. P0/P1 er aktiv eller regulatorisk risiko øker ved å vente.
2. Rollback er vurdert og avvist eller er farligere enn forward-fix.
3. Tobias godkjenner eksplisitt.
4. Patch er minimal og isolert.
5. Incident/Linear-lenke finnes før merge.
6. Required checks kjøres så langt de er teknisk mulige.
7. PR merkes med `approved-emergency-merge` og
   `post-merge-review-required`.

Hvis branch protection blokkerer en ekte P0-fix:

- Ikke push direkte til `main` i stillhet.
- Ikke slå av branch protection uten skriftlig Tobias-beslutning i
  incident-logg.
- Hvis branch protection midlertidig endres, logg nøyaktig:
  tidspunkt, hvem, hvilke checks/reviews som ble endret, hvorfor,
  commit SHA som ble merget, og tidspunkt kontrollen ble skrudd på igjen.
- Etterpå skal postmortem vurdere om branch protection var for rigid
  eller om hotfixen burde vært forberedt annerledes.

---

## 10. Offboarding og revokering

Ved rollebytte, avbrutt leverandørforhold eller kompromittert tilgang:

1. Fjern GitHub collaborator eller reduser permission.
2. Revoker personlig GitHub PAT.
3. Revoker Render/Sentry/PostHog/Linear/1Password-tilgang.
4. Roter alle delte secrets personen kan ha sett.
5. Sjekk GitHub audit-logg for nylige branch-protection, secret og
   deploy-endringer.
6. Oppdater dette dokumentet og
   [`CREDENTIALS_AND_ACCESS.md`](./CREDENTIALS_AND_ACCESS.md).

---

## 11. Referanser

- [`.github/CODEOWNERS`](../../.github/CODEOWNERS)
- [`CREDENTIALS_AND_ACCESS.md`](./CREDENTIALS_AND_ACCESS.md)
- [`HOTFIX_PROCESS.md`](./HOTFIX_PROCESS.md)
- [`PM_PR_VERIFICATION_DUTY.md`](./PM_PR_VERIFICATION_DUTY.md)
- [`KNOWLEDGE_CONTROL_PRELOCK_REVIEW_2026-05-15.md`](../engineering/KNOWLEDGE_CONTROL_PRELOCK_REVIEW_2026-05-15.md)
