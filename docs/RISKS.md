# Risk Register — Spillorama-system

**Sist oppdatert:** 2026-05-10
**Eier:** Tobias Haugen
**Status:** Aktiv (levende dokument)
**Review-kadens:** Månedlig + ved hver pilot-milestone

> **Til ny PM:** Dette er en **levende oversikt** over kjente risikoer. Ulik
> [`BACKLOG.md`](../BACKLOG.md) (som er "hva skal vi gjøre"), er dette
> **"hva kan gå galt"**. Når du oppdager en ny risiko — legg den til. Når en
> risiko er materialisert (skjedd) — flytt den til
> [`docs/postmortems/`](./postmortems/).
>
> **Skill-relasjon:** Risikoer som går igjen blir til
> [`.claude/skills/<navn>/SKILL.md`](../.claude/skills/) for å lære AI-agentene
> å unngå dem.

---

## Format

Hver risiko har:
- **ID** — `R-NNN` (sekvensielt)
- **Kategori** — Technical | Compliance | Operational | Vendor | People
- **Sannsynlighet** — Lav / Medium / Høy
- **Konsekvens** — Lav / Medium / Høy / Kritisk
- **Mitigasjon** — hva som er gjort eller planlagt
- **Eier** — hvem som følger opp
- **Sist gjennomgått** — dato

Risikoer som er fullstendig mitigert flyttes ikke ut — de markeres `Mitigated`
og beholdes for kontekst.

---

## Aktive risikoer (sortert etter konsekvens × sannsynlighet)

### R-001 — Bus-faktor 1 (Tobias eneste reviewer/admin)

- **Kategori:** People
- **Sannsynlighet:** Medium (over 12 mnd)
- **Konsekvens:** Kritisk
- **Beskrivelse:** Tobias er eneste CODEOWNER, eneste Render-admin, eneste
  Lotteritilsynet-kontaktperson, eneste BankID/Swedbank-vendor-kontaktperson.
  Hvis Tobias er utilgjengelig (sykdom, ulykke, oppsigelse), kan hele
  drift- og deploy-flyten stoppe.
- **Mitigasjon (delvis, ny per 2026-05-10):**
  - Emergency-runbook for PM-autonomi: [`docs/operations/EMERGENCY_RUNBOOK.md`](./operations/EMERGENCY_RUNBOOK.md)
  - Bus-faktor-delegerings-plan: [`docs/operations/BUS_FACTOR_PLAN.md`](./operations/BUS_FACTOR_PLAN.md) (planlagt, ikke aktivert ennå)
  - Stakeholder-oversikt med eskaleringskjede: [`docs/operations/STAKEHOLDERS.md`](./operations/STAKEHOLDERS.md)
- **Mitigasjon (manglende — handling kreves fra Tobias):**
  - Identifisere konkret backup-person og dele 1Password-vault (read-only OK)
  - Periodisk "what if Tobias is gone"-øvelse (årlig)
  - Back-up Render-admin-tilgang
  - Trinn 4 Fase 1 i BUS_FACTOR_PLAN — sertifisere første backup-reviewer
- **Eier:** Tobias
- **Sist gjennomgått:** 2026-05-10
- **Status:** Plan eksisterer, ikke aktivert. Aktiver Fase 2 når team utvides eller etter 5+ dagers utilgjengelighet

---

### R-002 — Pengespillforskriften-tolkning kan endres

- **Kategori:** Compliance
- **Sannsynlighet:** Lav-Medium (over 12-24 mnd)
- **Konsekvens:** Kritisk
- **Beskrivelse:** Lotteritilsynet kan endre tolkning av §11 (distribusjons-
  prosenter), spillvett-krav, eller RNG-sertifiserings-krav. Ny tolkning kan
  kreve arkitekturendringer eller stoppe lansering.
- **Mitigasjon:**
  - Compliance-docs (`docs/compliance/`) holder kanonisk tolkning
  - SPILLKATALOG.md er autoritativ for §11-prosenter
  - Hash-chain audit-trail gir bevis for compliance ved tilsyn
  - Skill `pengespillforskriften-compliance` koder reglene
- **Manglende:**
  - Ingen tett dialog med Lotteritilsynet (vi venter på henvendelser)
  - Ingen jevnlig sjekk av nye tolkninger / rundskriv
- **Eier:** Tobias
- **Sist gjennomgått:** 2026-05-10
- **Status:** Åpen — vurder kvartalsvis sjekk av Lotteritilsynet-publikasjoner

---

### R-003 — Render single-region (Frankfurt) avhengighet

- **Kategori:** Vendor / Technical
- **Sannsynlighet:** Lav (per incident) — Høy (over 24 mnd)
- **Konsekvens:** Høy
- **Beskrivelse:** Hele prod-stack kjører i Render Frankfurt. Ved Render-
  outage eller region-feil er hele Spillorama nede. SLA: 99.95 % per Render —
  men korresponderer til ~22 min nedetid/måned.
- **Mitigasjon:**
  - DR-plan i `docs/operations/DISASTER_RECOVERY_PLAN_2026-04-25.md`
  - Postgres backups (Render-managed)
  - Blue-Green deploys reduserer deploy-relatert nedetid
- **Manglende:**
  - Ingen multi-region failover
  - Ingen provider-redundans (kun Render)
  - DR-drill ikke kjørt nylig — `docs/operations/dr-drill-log/` er stort sett tomt
- **Eier:** Tobias
- **Sist gjennomgått:** 2026-05-10
- **Status:** Akseptert risiko for pilot. Re-evaluer ved 24-hall skalering

---

### R-004 — Spill 2/3 perpetual loop må holde 99.95 % oppetid

- **Kategori:** Technical / Operational
- **Sannsynlighet:** Medium (per pilot-uke uten R1-R12 fullført)
- **Konsekvens:** Høy
- **Beskrivelse:** Spill 2/3 har ETT globalt rom hver. Hvis det globale rommet
  henger eller crasher, er spillet nede for alle haller samtidig. Spill 1 er
  per-hall og dermed mer robust.
- **Mitigasjon:**
  - LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08 + R1-R12 pilot-gating
  - Skills `spill2-perpetual-loop`, `spill3-phase-state-machine`,
    `live-room-robusthet-mandate`
  - Strukturerte error-codes (Fase 2A pågående)
  - Trace-ID propagation (MED-1 pågående)
- **Manglende:**
  - R4 (load-test 1000 samtidige), R6 (outbox-validering),
    R9 (24t leak-test) ikke bestått enda
  - Ingen automatisk rom-restart hvis state-machine henger
- **Eier:** Tobias + AI-agenter (refactor-bølger)
- **Sist gjennomgått:** 2026-05-10
- **Status:** Aktiv mitigasjon — R1-R12 er pilot-gating

---

### R-005 — Wallet-integritet ved samtidige operasjoner

- **Kategori:** Technical / Compliance
- **Sannsynlighet:** Lav (etter mitigasjon)
- **Konsekvens:** Kritisk (regulatorisk + finansiell)
- **Beskrivelse:** Wallet er finansielt system. Race-conditions på balanse
  eller dobbel-payout har direkte regulatorisk implikasjon (kan miste lisens).
- **Mitigasjon:**
  - Outbox pattern (BIN-761→764)
  - REPEATABLE READ isolation
  - Hash-chain audit-trail
  - Skill `wallet-outbox-pattern` + `audit-hash-chain`
  - Compliance-tester i CI (`npm run test:compliance`)
- **Manglende:**
  - R6 (outbox-validering på prod-data) ikke bestått enda
  - Ingen reconciliation-cron som auto-sammenligner Postgres vs Redis-state
- **Eier:** Tobias
- **Sist gjennomgått:** 2026-05-10
- **Status:** Mitigert i hovedsak — R6 gjenstår

---

### R-006 — AI-agent-kontekst-drift mellom sesjoner

- **Kategori:** Operational
- **Sannsynlighet:** Høy (uten mitigasjon)
- **Konsekvens:** Medium
- **Beskrivelse:** Claude/AI-agenter mister all kontekst mellom sesjoner.
  Uten formell handoff blir hver ny sesjon en re-orientering, og
  beslutninger glemmes / repeteres.
- **Mitigasjon:**
  - SESSION_HANDOFF_PROTOCOL (detaljert mal)
  - PM_ONBOARDING_PLAYBOOK (full kontekst på 60-90 min)
  - Auto-generated docs (current state alltid friskt)
  - ADR-system for "why"-bevaring
  - 35 skills + CLAUDE.md som auto-kontekst
  - 9 PM_HANDOFF-historikk
  - `agent-onboarding.sh` + `pm-onboarding.sh`-scripts
  - **NEW 2026-05-10:** Vanntett 4-lags PM-håndhevings-system (BIN-PM-VT)
- **Status:** Godt mitigert — fortsatt åpen som påminnelse

---

### R-007 — Auto-deploy fra `main` til prod

- **Kategori:** Technical
- **Sannsynlighet:** Lav (per merge, etter CI)
- **Konsekvens:** Høy (hvis dårlig kode når prod)
- **Beskrivelse:** Render auto-deploy fra `main` betyr at en merget PR med
  bug går rett til prod uten manuell sluttkontroll.
- **Mitigasjon:**
  - 18+ GitHub Actions inkludert ci.yml, compliance-gate, e2e-test,
    visual-regression, schema-ci, performance-budget
  - PM verifiserer CI etter PR-åpning (Tobias-direktiv 2.3)
  - Pre-commit hooks blokkerer dårlige commits
  - Architecture-lint (dependency-cruiser) i CI
  - PILOT_SMOKE_TEST_CHECKLIST etter deploy
  - ROLLBACK_RUNBOOK ved feil
  - **NEW 2026-05-10:** pm-merge-verification.yml åpner GitHub Issue + tagger PM hvis CI feiler post-merge
- **Manglende:**
  - Ingen staging-canary-fase mellom main og prod
  - `promote-staging-to-main.yml` finnes, men brukes ikke alltid
- **Eier:** Tobias
- **Status:** Akseptert for pilot. Re-evaluer ved 24-hall

---

### R-008 — Vendor lock-in (Render, Swedbank Pay, BankID)

- **Kategori:** Vendor
- **Sannsynlighet:** Lav (per incident) — Medium (over 36 mnd)
- **Konsekvens:** Medium-Høy
- **Beskrivelse:** Migrasjon vekk fra Render, Swedbank Pay eller BankID ville
  ta uker-måneder. Pris-økning eller policy-endring fra leverandør kan tvinge
  hånden vår.
- **Mitigasjon:**
  - Adapter-pattern i backend (`apps/backend/src/adapters/`) abstraherer
    wallet, KYC, RNG bak interfaces
  - `WALLET_PROVIDER`, `KYC_PROVIDER` env-flags støtter alternativ-implementasjoner
  - Docker-basert deployment kan teoretisk migrere til annen PaaS
- **Manglende:**
  - Ingen pris-/SLA-overvåkning per vendor
  - Kontraktdatoer trackes nå i `docs/operations/VENDORS.md` (krever utfylling)
- **Eier:** Tobias
- **Status:** Åpen — lavt prioritet til pilot er stabil

---

### R-009 — Documentation drift / stale docs

- **Kategori:** Operational
- **Sannsynlighet:** Høy (uten aktiv mitigasjon)
- **Konsekvens:** Medium (sløsing av tid, ikke umiddelbart farlig)
- **Beskrivelse:** Med 421 markdown-filer er det høy risiko for at noen blir
  utdaterte og motsier hverandre, noe som villeder PMs/agenter.
- **Mitigasjon:**
  - INVENTORY.md kategoriserer som A-J (sannhets-kilder vs arkiv vs research)
  - Auto-genererte docs i `docs/auto-generated/` regenereres fra koden
  - "Doc-en vinner over kode" — direktiv 2.4
  - Pre-commit hooks validerer markdown-lenker
  - PR-template krever doc-oppdatering på arkitekturendring
  - **NEW 2026-05-10:** doc-freshness.yml CI-workflow advarer på docs >90 dager
- **Status:** Mitigert i hovedsak — automatisk freshness-sjekk er aktiv

---

### R-010 — Postmortem-historikk samles ikke sentralt (FIKSET 2026-05-10)

- **Kategori:** Operational
- **Sannsynlighet:** —
- **Konsekvens:** Medium (lessons-learned glemmes)
- **Beskrivelse:** Per 2026-05-09 fantes ingen sentral postmortem-katalog.
  Lessons-learned var spredt over Slack, handoffs og diskusjoner.
- **Mitigasjon:**
  - `docs/postmortems/` opprettet 2026-05-10 med template og index
  - Kobles til `RISKS.md`: når en risiko materialiseres → postmortem skrives
- **Status:** Mitigated 2026-05-10

---

## Når en ny risiko oppdages

1. Velg neste ledige `R-NNN`
2. Legg til seksjon her med samme struktur som over
3. Oppdater "Sist oppdatert"-feltet øverst
4. Hvis risikoen er kritisk: nevn den i neste PM-handoff og i BACKLOG hvis
   det er et konkret arbeid som kreves
5. Hvis risikoen krever ny invariant/regel: vurder ADR

## Når en risiko materialiseres (skjer)

1. Skriv postmortem i `docs/postmortems/YYYY-MM-DD-<kort-navn>.md`
2. Oppdater denne filen: marker risikoen `Materialized → see postmortem`
3. Oppdater mitigasjons-status etter postmortem-actions er gjennomført

## Kvartalsvis review

Hver kvartalsslutt: gå gjennom alle åpne risikoer:
- Er status fortsatt korrekt?
- Er mitigasjon gjennomført?
- Er det nye risikoer vi har oversett?

Logg review-runde med dato i denne filens "Sist oppdatert"-felt.

---

**Se også:**
- [`BACKLOG.md`](../BACKLOG.md) — aktivt arbeid og pilot-blokkere
- [`docs/postmortems/`](./postmortems/) — incidenter som har skjedd
- [`docs/operations/DISASTER_RECOVERY_PLAN_2026-04-25.md`](./operations/DISASTER_RECOVERY_PLAN_2026-04-25.md)
- [`docs/operations/COMPLIANCE_INCIDENT_PROCEDURE.md`](./operations/COMPLIANCE_INCIDENT_PROCEDURE.md)
