---
name: dr-runbook-execution
description: When the user/agent works with disaster recovery, backup-drills, incident-response, or pilot-stability runbooks for the Spillorama bingo platform. Also use when they mention DR, disaster recovery, restore, backup, drill, RPO, RTO, incident-response, hotfix, rollback, redis-failover, db-restore, PITR, compliance-incident, wallet-reconciliation, BIN-790, BIN-816, BIN-772, SEV-1, SEV-2, SEV-3, Lotteritilsynet 24t, Datatilsynet 72t, on-call, R12. Defines RPO/RTO targets, severity matrix, drill cadence, regulator-SLA timelines, and pre-pilot drill gates. Make sure to use this skill whenever someone touches DR runbooks or asks about incident-response procedures even if they don't explicitly ask for it — pilot-launch is gated on at least one rehearsal per scenario.
metadata:
  version: 1.0.0
  project: spillorama
---

<!-- scope: docs/operations/DR_RUNBOOK.md, docs/operations/LIVE_ROOM_DR_RUNBOOK.md, docs/operations/COMPLIANCE_INCIDENT_PROCEDURE.md, docs/operations/INCIDENT_RESPONSE_PLAN.md, docs/operations/HALL_PILOT_RUNBOOK.md, docs/operations/EMERGENCY_RUNBOOK.md, docs/operations/DRILL_BACKUP_RESTORE_*.md, docs/operations/DRILL_ROLLBACK_*.md, docs/operations/PILOT_*_RUNBOOK*.md -->

# DR Runbook Execution

## Kontekst

Spillorama går mot pilot 2026 i 4 haller (Teknobingo Årnes som master + Bodø + Brumunddal + Fauske) som regulert pengespill-plattform. Under pengespillforskriften har vi rapporterings-SLA-er:
- **Lotteritilsynet:** rapport av compliance-hendelse innen **24 timer**.
- **Datatilsynet (GDPR):** brudd-rapport innen **72 timer**.

R12 (BIN-816) i Live-Room Robustness-mandatet krever at hver DR-prosedyre er **øvd minst én gang per scenario** før pilot-start. "Best effort, fix in drift" er IKKE et akseptabelt go-live-kriterium.

## Kjerne-arkitektur

### RPO + RTO-mål

| Mål | Verdi | Begrunnelse |
|---|---|---|
| **RPO** (max datatap) | ≤ 5 min | Postgres WAL-arkivering kontinuerlig + nattlig base-backup |
| **RTO backend restart** | ≤ 30 min | Render redeploy ~5 min + DNS-/cache-propagering + smoke |
| **RTO database (full restore)** | ≤ 2 timer | Render-managed Postgres PITR + DNS-flip |
| **RTO live-rom-recovery** | < 2 min | Reconnect til annen backend-instans (R2-mandat) |

### Severity-matrise (HALL_PILOT_RUNBOOK)

| Severity | Definisjon | Eskalering |
|---|---|---|
| **SEV-1** | Compliance/payout/tap-feil, datatap, sikkerhetsbrudd | Umiddelbar rollback-vurdering |
| **SEV-2** | Stor funksjonsfeil uten compliance-brudd | > 15 min uten workaround → rollback-vurdering |
| **SEV-3** | Mindre avvik med workaround | Vanlig fix-flow |

Rollback trigges hvis:
- Plattform utilgjengelig > 10 min i pilot-vindu
- Incident Commander klassifiserer som SEV-1

### 7 live-rom-scenarier (LIVE_ROOM_DR_RUNBOOK)

| # | Scenario | Worst-case impact | Recovery RTO |
|---|---|---|---|
| S1 | Backend-instans dør midt i Spill 1-runde | Flere haller fryser samtidig | < 2 min reconnect |
| S2 | Redis dør (rom-state tapt) | Alle armed-states slettes | < 5 min restart |
| S3 | Postgres-primary failover | Mulig duplikat-draw etter failover | < 30 min verifisert |
| S4 | Render-region down (Frankfurt) | Hele plattformen nede | Manuell, timer |
| S5 | DDoS / rate-limit-flom | Live-rom kveler eller fryser | < 10 min mitig. |
| S6 | Manuell rolling restart | Risiko for tapt mid-runde-state | < 90 sek per node |
| S7 | Spill 2 perpetual-loop-leak (akut) | OOM, alle spill-typer påvirket | < 15 min |

### Pre-pilot drill-gates

Per R12: minst én øvelse per scenario før pilot. Utvalgte drills:

| Drill | Innhold | Frekvens | Status |
|---|---|---|---|
| D-DB-RESTORE-1 | PITR til kjent timestamp i staging | Quarterly | TODO pre-pilot |
| D-REDIS-1 | Drep Redis, verifiser auto-restart + state-rebuild | Quarterly | TODO pre-pilot |
| D-COMP-1 | Simulert compliance-incident → 24t-rapport-flow | Quarterly | TODO pre-pilot |
| D-COMP-2 | Simulert GDPR-brudd → 72t-rapport-flow | Quarterly | TODO pre-pilot |
| D-RECON-1 | Wallet-reconciliation finder forskjell → flow | Quarterly | OK Validert 2026-05-01 (21→0 alerts) |

## Immutable beslutninger

### Lotteritilsynet 24t / Datatilsynet 72t er hard SLA

Hvis en compliance-hendelse skjer (f.eks. dobbelt-payout, tap av audit-rad, brudd på §66 obligatorisk pause):

1. **Innen 1 time:** Incident Commander klassifiserer + Tobias varsles
2. **Innen 4 timer:** initial vurdering med foreløpig årsaks-analyse
3. **Innen 24 timer:** rapport til Lotteritilsynet (via etablert kanal)
4. **Innen 72 timer:** GDPR-rapport hvis personopplysninger påvirket
5. **Innen 7 dager:** post-mortem publisert internt

**Aldri** vente med å varsle fordi "vi er ikke sikre ennå". Bedre å oppdatere senere enn å miste fristen.

### Recovery må aldri tape audit-rader

Per pengespillforskriften skal hver ball + hvert payout være auditerbart. En recovery som taper en `game.draw`-event eller dobler en `game.pattern.won`-event er en rapporterbar hendelse til Lotteritilsynet.

R2-failover-test (BIN-811) verifiserer dette via I4 (compliance-ledger-rader bevart).

### On-call-rotasjon må signeres pre-pilot

Per `DISASTER_RECOVERY_PLAN_2026-04-25.md` §10 er dette en TODO før pilot:
- Hvem er primary on-call?
- Hvem er backup?
- Eskaleringsvei til Tobias?
- PagerDuty / Slack-channel-konfiguration?

Ingen pilot-go-live uten signert rotasjons-plan.

### Ingen pilot uten verifisert PITR

`DISASTER_RECOVERY_PLAN_2026-04-25.md` §10 risiko #2: vi har ALDRI test-restored prod-Postgres til en kjent timestamp. Dette MÅ kjøres før pilot.

Drill D-DB-RESTORE-1: 
1. Snapshot prod-DB-state ved time T
2. Insert kjent kanari-rad ved T+5min
3. PITR til T (rull frem til 5 min før kanari)
4. Verifiser at kanari-rad IKKE finnes
5. Mål total RTO

### Hotfix krever 4 trigger-kriterier

Per `HOTFIX_PROCESS.md` (skissert i existing docs): hotfix utenfor vanlig PR-flyt krever:

1. **SEV-1 klassifisering** av Incident Commander
2. **Minimal patch** — endre kun det som må endres
3. **Audit-trail** — hvorfor + hva + hvem signerte off
4. **7-dagers post-mortem** og review

Hotfix-process bypasser code-reviewer-gate, så bruk sparsomt.

### Communication template for spillere

Når en runde fryser kan vi ikke skjule det. Per LIVE_ROOM_DR_RUNBOOK §10: hall-eier får eksakt tekst å sende til spillere:

```
Bingo-runden er midlertidig pauset på grunn av en teknisk feil.
Innsatsene dine er trygge. Vi gjenoppretter spillet innen [N] minutter.
Beklager ulempen.
```

Aldri spekuler i årsak før post-mortem.

## Vanlige feil og hvordan unngå dem

| Feil | Symptom | Fix |
|---|---|---|
| Vente med Lotteritilsynet-varsel "til vi er sikre" | 24t-fristen sprenges | Varsle umiddelbart, oppdater senere |
| Hotfix uten audit-trail | Senere revisjon kan ikke verifisere endringen | Kreve 4-kriterie-prosedyre |
| Glemt å oppdatere on-call-rotasjon | Ingen svarer på PagerDuty-call | Signert rotasjon før pilot |
| PITR-prosedyre kun "i hodet" | Når katastrofen treffer er det første gang noen prøver | Kjør D-DB-RESTORE-1 quarterly |
| Recovery taper audit-rader | Compliance-brudd | Verifiser via R2-invarianter (I4) |
| Spillere får fri-tekst-feilmelding | Spekulasjon før post-mortem | Bruk communication-template |
| Rollback uten validering av compliance-state | Skjult datatap | Wallet-reconciliation kjøres etter hver rollback |
| Wallet-reconciliation kjøres kun manuelt | Avvik fanges sent | Daglig automatisk cron + Sentry-alert |

## Kanonisk referanse

- `docs/operations/DISASTER_RECOVERY_PLAN_2026-04-25.md` — RPO/RTO, 7 scenarier, anbefalinger
- `docs/operations/LIVE_ROOM_DR_RUNBOOK.md` — R12-spesifikke live-rom-scenarier
- `docs/operations/HALL_PILOT_RUNBOOK.md` — SEV-1/2/3 + rollback-kriterier
- `docs/operations/MIGRATION_DEPLOY_RUNBOOK.md` — migrate-feil under deploy
- `docs/operations/ROLLBACK_RUNBOOK.md` — hall-spesifikk rollback (client-variant flag)
- `docs/operations/REDIS_KEY_SCHEMA.md` — surgical Redis-recovery
- `docs/operations/OBSERVABILITY_RUNBOOK.md` — alerts, dashboards, metrics
- `docs/operations/RENDER_ENV_VAR_RUNBOOK.md` — env-vars + secrets
- `docs/architecture/LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08.md` §3.4 R12

## Når denne skill-en er aktiv

- En produksjons-incident inntreffer (klassifiser SEV, eskaler)
- Pre-pilot drill-planlegging (D-DB-RESTORE-1, D-REDIS-1, etc.)
- Post-mortem-skriving etter incident
- Endre on-call-rotasjon eller PagerDuty-konfig
- Reviewe en hotfix-PR for 4-kriterie-compliance
- Verifisere RPO/RTO-mål i en ny tjeneste eller arkitektur-endring
- Skrive eller oppdatere DR-runbook
- Lotteritilsynet- eller Datatilsynet-rapport-skriving
- Vurdere om en feilkonfig krever rollback (SEV-1-vurdering)
- Pre-pilot go/no-go-møte (R12 drill-status)
