# Hotfix Process (BIN-790 C4)

**Owner:** Technical lead (Tobias Haugen)
**Related Linear:** BIN-790 (M2 — Multi-hall-launch, Spor C — Operasjon & infrastruktur)
**Last updated:** 2026-05-08
**Audience:** Tobias (myndighet), L2 backend on-call (utfører), L3 incident commander (godkjenner).

> Denne runbooken beskriver hvordan vi deployer en kritisk fix UTEN
> full review-prosess (P1 lyst-løp). For:
>
> - **Normal deploy** (CI + review + merge): se
>   [`docs/engineering/ENGINEERING_WORKFLOW.md`](../engineering/ENGINEERING_WORKFLOW.md).
> - **Rollback i stedet for forward-fix**: se
>   [`DEPLOY_ROLLBACK_PROCEDURE.md`](./DEPLOY_ROLLBACK_PROCEDURE.md).
> - **Migration-spesifikk feil**: se
>   [`MIGRATION_DEPLOY_RUNBOOK.md`](./MIGRATION_DEPLOY_RUNBOOK.md).

---

## 0. TL;DR

Hotfix-prosessen finnes for én type situasjon:

> Vi har en P1-hendelse, rollback ikke er mulig (eller er verre), og vi
> trenger en patch ut **i løpet av minutter**, ikke timer.

Den koster:

- **Audit-trail-overhead** — alt skal loggføres som om det var et
  vanlig deploy, men med "skip-review-grunn" notert.
- **Etter-revisjon** — fixen skal review-es og evt. omskrives innen 7
  dager etter hendelsen.
- **Risiko for ny bug** — du skipper review, så testkrav er strengere
  (smoke + manuell test før prod-deploy).

Bruk den **bare** når §1 trigger faktisk er møtt.

---

## 1. Trigger — når er hotfix-prosess riktig?

### 1.1 Hotfix-trigger (alle 4 må være møtt)

1. **P1-klassifisert** ([`INCIDENT_RESPONSE_PLAN.md`](./INCIDENT_RESPONSE_PLAN.md) §1).
2. **Rollback ikke et alternativ** — enten umulig (kompatibilitets-
   migrasjon, slettet image), eller verre (rollback restorer en kjent
   compliance-bug).
3. **L3 + Tobias er enige** at forward-fix er beste vei. Logg
   beslutningen før du starter.
4. **Fixen er liten og isolert** — én funksjon, én ENV-flag, eller én
   SQL-correction. Ikke breaking refactor.

### 1.2 Eksempler — JA, hotfix riktig

- Compliance-konstant feil (eks. `BINGO_DAILY_LOSS_LIMIT` satt til 9000
  i stedet for 900) — fix: oppdater env-var, restart backend.
- Wallet-debit-flow har en off-by-one feil i en kondisjon — én linje
  fix.
- Engine kaster på en uventet input som ikke finnes i staging-data —
  legg til guard-clause.
- Migration la til UNIQUE-constraint som forretnings-data ikke matcher —
  ny migration som retter constraint.

### 1.3 Eksempler — NEI, hotfix feil

- Ny feature er ikke ferdig — det er ikke P1, det er en bug.
- Performance er degradert — bruk vanlig deploy-flow med caching/
  optimering.
- "Vi vil bare ha denne ut før helga" — ikke akseptabel grunn.
- Refactor for å gjøre kode "lettere å vedlikeholde" — det er
  vedlikeholdsoppgave, ikke hotfix.

---

## 2. Detection — hvordan ankommer behovet?

Hotfix-behov oppstår typisk fra:

- Pågående P1-incident hvor rollback er forsøkt og ikke fungerer.
- Sentry-burst etter deploy hvor problemet er identifisert som
  rettbart i en liten patch.
- Compliance-eier oppdager regulatorisk regresjon som må fikses i dag.
- Tobias eller L3 ber om hotfix etter incident-vurdering.

---

## 3. Severity & autoritet

| Hvem starter? | Hvem godkjenner? | Hvem deployer? |
|---|---|---|
| L2 backend on-call (under aktiv incident) | L3 incident commander **+** Tobias | L2 (CI auto-deploy via push til main) |
| Compliance-eier (compliance-fix) | Tobias | L2 |
| Tobias (selv-trigget) | Selv-godkjent (logg i Linear) | L2 eller Tobias |

**Aldri:**
- L1 hall-vakt deployer hotfix alene.
- Andre agenter (Spillorama-prosjekt-team) hotfixer uten Tobias-godkjenning.

---

## 4. Mitigation — hotfix-flow

### 4.1 Pre-flight (5 min)

Før du begynner å skrive kode:

1. **Bekreft at hotfix er riktig** per §1 trigger.
2. **Logg beslutning i Slack `#bingo-pilot-war-room`:**
   ```
   :rotating_light: HOTFIX TRIGGER

   Incident: [link]
   Hvorfor hotfix (ikke rollback): [én setning]
   Forventet patch-størrelse: [eks. "1 linje i WalletService.ts"]
   Eier: @[L2-vakt]
   Godkjent av: @[L3] og @Tobias
   Forventet deploy-tid: [hh:mm]
   ```
3. **Open Linear-issue** i forkant: `BIN-XXX HOTFIX: <kort tittel>`.
   Tag som `incident:hotfix`, prioritet Urgent.

### 4.2 Branch + commit (10 min)

```bash
# Sjekk ut main lokalt
git checkout main
git pull origin main

# Lag hotfix-branch
git checkout -b hotfix/<linear-id>-<short-desc>

# Skriv minimal patch
# (Følg "minimal scope" — ingen refactor, ingen "while I'm here"-fixes)

# Commit
git add <only-the-files-you-changed>
git commit -m "fix: <one-line description>

Hotfix per [INCIDENT_RESPONSE_PLAN.md](docs/operations/INCIDENT_RESPONSE_PLAN.md)
[link til incident-Slack-tråd]

BIN-XXX
"

# Push
git push -u origin hotfix/<linear-id>-<short-desc>
```

### 4.3 Test (5–15 min, avhengig av hastebehov)

**Minimum** (alltid):

```bash
# TypeScript compile
npm --prefix apps/backend run check

# Compliance suite (hvis fixen rører compliance-flow)
npm --prefix apps/backend run test:compliance

# Unit-test for endret kode
npm --prefix apps/backend test -- <relevant-filename>
```

**Anbefalt** hvis tid tillater (5–10 min ekstra):

```bash
# Full unit-test
npm test

# Build for å verifisere at den faktisk bygger
npm run build
```

**Skip** kun hvis P1 er aktiv og hver minutt teller:

- Visual regression (Playwright)
- Full integration-suite

### 4.4 Staging-deploy (5–10 min)

> **Skip kun ved ekstrem hastebehov** og dokumenter hvorfor.

```bash
# Merge hotfix-branch til staging
git checkout staging
git merge hotfix/<linear-id>-<short-desc> --no-ff
git push origin staging

# Render staging auto-deployer (~5 min)
# Verifiser staging-smoke per E2E_SMOKE_TEST.md
```

### 4.5 Prod-deploy (5 min)

```bash
# Merge til main (skip review)
git checkout main
git merge hotfix/<linear-id>-<short-desc> --no-ff
git push origin main

# Render auto-deployer (5–10 min med migrate-step)
```

**Hvis CI er konfigurert til å kreve review** (typisk i branch protection):

- Tobias eller L3 må manuelt approve-e PR-en.
- L2 (eller den som har push-access) merger med "Squash and merge"
  (override review-krav).

### 4.6 Verification post-deploy (10 min)

| Sjekk | Forventet |
|---|---|
| `/health` returnerer 200 | Innen 30 sek etter deploy-completion |
| `/api/version` viser ny commit-SHA | Matcher hotfix-commit |
| Sentry: ingen ny exception fra hotfix-pathen | 0 i 5 min etter deploy |
| Spesifikk feil-symptom borte | Manuell verifisering — hva som var P1-trigger |
| Compliance-test grønn på prod (hvis relevant) | `npm run test:compliance` mot prod-mirror |

---

## 5. Audit-krav

Hotfix-prosessen kort-slutter normal review, men **alle audit-krav
består**. Følgende skal være på plass innen 24 timer etter hotfix:

### 5.1 Linear-issue oppdatert

- Status: `Done` etter at hotfix er live.
- Kommentarer:
  - Slack-tråd-link til incident.
  - Commit-SHA på main.
  - Liste over filer endret.
  - Begrunnelse for skip-review (1-2 setninger).
  - Test-status (hva ble kjørt, hva ble skipper og hvorfor).

### 5.2 Etter-review

Innen 7 dager skal hotfix-koden gjennomgås av en kollega som **ikke**
var involvert i hendelsen:

- Pull request mot retroaktiv branch (eller ny PR for forbedringer).
- Standard review-checklist.
- Hvis review avdekker bedre løsning: spawn ny issue, ikke retroaktivt
  endre hotfix-commit.

### 5.3 Compliance-vedlegg

Hvis hotfix endret compliance-flow:

- Compliance-eier signerer review.
- Linear-issue tagges `compliance:reviewed`.
- Hvis fixen kunne ha forhindret regulatorisk-rapport: vurder
  Lotteritilsynet-melding ([`COMPLIANCE_INCIDENT_PROCEDURE.md`](./COMPLIANCE_INCIDENT_PROCEDURE.md)).

---

## 6. Communication

### 6.1 Under hotfix

```
[hh:mm] Hotfix-status

Branch: hotfix/<linear-id>
Test-status: [TS check ✅ | Compliance ✅ | Staging-smoke ✅]
Forventet prod-deploy: [hh:mm]
```

### 6.2 Etter hotfix live

```
:white_check_mark: Hotfix live

Commit: <sha>
Symptom resolved: [hh:mm]
Linear: BIN-XXX
Etter-review: planlagt innen 7 dager
```

### 6.3 Hall-eier

Hvis hotfix var resultat av synlig P1: bruk
[`INCIDENT_RESPONSE_PLAN.md`](./INCIDENT_RESPONSE_PLAN.md) §6.1
template med "Vi har deployet en fix klokken hh:mm."

### 6.4 Lotteritilsynet

Bruk [`COMPLIANCE_INCIDENT_PROCEDURE.md`](./COMPLIANCE_INCIDENT_PROCEDURE.md)
hvis hotfix berører regulatorisk-meldepliktig kode.

---

## 7. Anti-mønstre — ikke gjør

### 7.1 "Stille hotfix"

Ikke push til main uten Slack-varsling. Selv hvis Tobias er den eneste
som er våken, skal det være en log-rad slik at neste vakt kan se hva
som skjedde.

### 7.2 "Hotfix og glem"

Hotfix uten Linear-issue og uten etter-review er teknisk gjeld som
sannsynligvis biter oss tilbake. Skriv issue **før** du skriver kode.

### 7.3 "Mens jeg er her ..."

Hotfix er minimal patch. Ikke fiks andre bugs i samme commit. Ikke
oppgrader avhengigheter. Ikke renammer filer. Hver ekstra endring er
en ny mulighet for ny feil.

### 7.4 "Hopp over staging"

Selv ved P1 er staging-smoke 5 minutter. Det reduserer sannsynligheten
for at hotfix introduserer ny P1 dramatisk. Skip staging kun hvis du
har eksplisitt autoritet fra Tobias og dokumenterer hvorfor.

### 7.5 "Skip Compliance-suiten"

Compliance-suite er rask (< 60 sek for typisk hotfix-scope). Aldri
skip når fixen rører:

- Wallet-flow
- KYC-gate
- Loss-limits
- Pause / self-exclusion
- Ledger-skriv
- Pengespillforskriften §11/§71

---

## 8. Verification (post-hotfix, dag-1)

Innen 24 timer etter hotfix:

- [ ] Hendelse er resolved (ingen recurring-symptom siste 12 t).
- [ ] Linear-issue oppdatert med alt fra §5.1.
- [ ] Sentry: ingen ny exception fra hotfix-pathen siste 12 t.
- [ ] Daglig wallet-recon-job (03:00 lokal) grønn neste natt.
- [ ] Compliance-eier signerer hvis relevant.
- [ ] Etter-review schedulert innen 7 dager.

---

## 9. Post-mortem

Alle hotfixes krever post-mortem per
[`INCIDENT_RESPONSE_PLAN.md`](./INCIDENT_RESPONSE_PLAN.md) §7. I tillegg
til standard post-mortem-spørsmål, svar:

1. **Hvorfor fant ikke pre-deploy-testen denne feilen?**
2. **Burde dette vært en automatisk alert i stedet for manuell?**
3. **Var hotfix-prosessen rask nok? Hvor var flaskehalsen?**
4. **Var skip-review-beslutningen riktig i ettertid?**

Action items:

- Oppdater test-suite for å fange feilen automatisk.
- Vurder om hotfix-flowen kan automatiseres ytterligere (eks. CI
  speed-up).

---

## 10. Drill-anbefaling

> **Status 2026-05-08:** Ingen formell hotfix-drill ennå. Foreslås:

| Drill | Frekvens | Eier |
|---|---|---|
| Table-top: simuler P1 hvor hotfix er beste alternativ | Kvartalsvis | L3 + Tobias |
| Practice hotfix på staging (ufarlig endring, full prosess) | Halvårlig | L2 backend |

### 10.1 Table-top-drill (45 min)

1. L3 presenterer en hypotetisk P1 (eks. "wallet-balanse-bug").
2. Diskuter:
   - Er rollback eller hotfix riktig?
   - Hvem starter, hvem godkjenner?
   - Hva er minimal patch-scope?
   - Hva tester vi?
3. Skriv ut beslutningen i sanntid.
4. Kjør gjennom §4 prosedyren steg for steg på papir.
5. Logg learnings.

---

## 11. Eierskap

| Rolle | Ansvar |
|---|---|
| Tobias (technical lead) | Endelig myndighet på hotfix-trigger og review-skip |
| L3 incident commander | Goder hotfix sammen med Tobias |
| L2 backend on-call | Utfører hotfix-prosedyren |
| Compliance-eier | Signerer compliance-relaterte hotfixes |
| DevOps | Sikrer at branch-protection tillater override-merge for L2/Tobias |

---

## 12. Referanser

- [`INCIDENT_RESPONSE_PLAN.md`](./INCIDENT_RESPONSE_PLAN.md) — overordnet incident-flow
- [`DEPLOY_ROLLBACK_PROCEDURE.md`](./DEPLOY_ROLLBACK_PROCEDURE.md) — alternativ til hotfix
- [`MIGRATION_DEPLOY_RUNBOOK.md`](./MIGRATION_DEPLOY_RUNBOOK.md) — migrate-feil
- [`COMPLIANCE_INCIDENT_PROCEDURE.md`](./COMPLIANCE_INCIDENT_PROCEDURE.md) — Lotteritilsynet
- [`E2E_SMOKE_TEST.md`](./E2E_SMOKE_TEST.md) — staging-smoke
- [`docs/engineering/ENGINEERING_WORKFLOW.md`](../engineering/ENGINEERING_WORKFLOW.md) — normal deploy-flow
