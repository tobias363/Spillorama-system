# PM-onboarding agent-prompts

**Bruk:** Hvis du er AI-PM ved første onboarding, spawn disse 6 Explore-agentene parallelt for kunnskaps-deep-dive. Mal-prompts under er testet 2026-05-09 og produserte komplett kunnskapsbase på ~10-15 min.

**Kjør parallelt:** Send alle 6 i samme tool-use-block for å maksimere parallellisme.

**Forventet total tid:** 10-15 min (rapportene returnerer asynkront).

---

## Agent A — Skills full-text deep-dive (7 sentrale skills)

```
Du er research-agent for å bygge en VANNTETT PM-onboarding-playbook for Spillorama-system. Forrige skills-research var oversiktlig — denne er full-text-deep-dive på de 7 mest pilot-kritiske skills.

**Oppgave:** Les SKILL.md i sin helhet i hver av disse 7 skills og produser en "kritiske invariants og fallgruver"-oppsummering:

1. /Users/tobiashaugen/Projects/Spillorama-system/.claude/skills/live-room-robusthet-mandate/SKILL.md
2. /Users/tobiashaugen/Projects/Spillorama-system/.claude/skills/spill1-master-flow/SKILL.md
3. /Users/tobiashaugen/Projects/Spillorama-system/.claude/skills/wallet-outbox-pattern/SKILL.md
4. /Users/tobiashaugen/Projects/Spillorama-system/.claude/skills/audit-hash-chain/SKILL.md
5. /Users/tobiashaugen/Projects/Spillorama-system/.claude/skills/pengespillforskriften-compliance/SKILL.md
6. /Users/tobiashaugen/Projects/Spillorama-system/.claude/skills/pm-orchestration-pattern/SKILL.md
7. /Users/tobiashaugen/Projects/Spillorama-system/.claude/skills/goh-master-binding/SKILL.md

**Produser strukturert rapport (markdown, max 350 linjer):**

For HVER skill:
- Når aktiveres (1 linje)
- Kjerne-invariants (max 5 — det som ALDRI skal endres)
- Vanlige fallgruver (max 5)
- Kritiske file:line-pekere (filer ny PM må kjenne)
- Relaterte ADR-er
- Pilot-relevans (blokker ja/nei)
- Cross-skill-koblinger

Etter alle 7, gi:
- Cross-cutting-mønstre (5-7 mønstre)
- Anbefalt leserekkefølge for ny PM med begrunnelse

Returner direkte i din response. File-paths overalt.
```

---

## Agent B — PM-handoff-historikk kronologi

```
Du er research-agent for ny PM på Spillorama-system. Ny PM trenger forstå hvordan prosjektet har utviklet seg fra 23. april 2026 til siste handoff.

**Oppgave:** Les ALLE PM-handoff-doc-er i kronologisk rekkefølge og produser tidslinje + utviklings-kronologi.

**Filer i /Users/tobiashaugen/Projects/Spillorama-system/docs/operations/:**
- PM_HANDOFF_2026-04-23.md
- PM_HANDOFF_2026-04-26.md
- PM_HANDOFF_2026-05-01.md
- PM_HANDOFF_2026-05-02.md
- PM_HANDOFF_2026-05-03.md
- PM_HANDOFF_2026-05-04.md
- PM_HANDOFF_2026-05-04_session2.md
- PM_HANDOFF_2026-05-05_session2.md
- PM_HANDOFF_2026-05-05_spill2-3-pilot-ready.md
- PM_HANDOFF_2026-05-07.md (forrige før siste)

(IKKE les nyeste — den har ny PM allerede lest)

**Produser:**
1. Tidslinje per handoff (én linje per dato)
2. Pågående refaktor-bølger (K1-K4, Bølge A-G)
3. Mest betydningsfulle arkitektur-beslutninger (3-5)
4. Kjente uløste blokkere (saker som har overlevd flere sesjoner)
5. Mønstre i Tobias' kommunikasjon

Hold under 300 linjer. Marker dato-prefiks for kronologi-sporbarhet.
```

---

## Agent C — Pilot-test-status og runbooks

```
Du er research-agent for ny PM på Spillorama-system (live bingo-plattform, pilot mot Q3 2026).

**Oppgave:** Kartlegg current pilot-readiness ved å lese chaos-test-resultater og pilot-runbooks. Ny PM må vite EXAKT hvor vi står på pilot-gating R1-R12.

**Filer å lese i /Users/tobiashaugen/Projects/Spillorama-system/docs/operations/:**
- R2_FAILOVER_TEST_RESULT.md
- R3_RECONNECT_TEST_RESULT.md
- R9_SPILL2_LEAK_TEST_RESULT.md
- R10_SPILL3_CHAOS_TEST_RESULT.md
- CHAOS_TEST_RESULTS_R2_R3_2026-05-08.md
- PILOT_GO_LIVE_RUNBOOK_2026-Q3.md
- PILOT_FLOW_TEST_CHECKLIST_2026-05-08.md
- PILOT_RUNBOOK_SPILL2_3_2026-05-05.md
- PILOT_4HALL_DEMO_RUNBOOK.md
- SPILL_VERIFICATION_REPORT_2026-05-08.md

Også:
- /Users/tobiashaugen/Projects/Spillorama-system/docs/architecture/LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08.md
- /Users/tobiashaugen/Projects/Spillorama-system/docs/architecture/PLAN_SPILL_KOBLING_FUNDAMENT_AUDIT_2026-05-08.md

**Produser:**
1. R-tiltak-tabell (R1-R12 status, pilot-blokker ja/nei)
2. Pilot-go-live-kriterier (hva må passere FØR pilot)
3. Kjente uløste pilot-risikoer
4. PLAN_SPILL_KOBLING_FUNDAMENT_AUDIT-funn
5. Pilot-haller-status

Hold under 250 linjer.
```

---

## Agent D — Compliance + Audit research

```
Du er research-agent for å bygge en VANNTETT PM-onboarding-playbook for Spillorama-system (live bingo-plattform, regulert pengespill under Lotteritilsynet, pilot mot Q3 2026).

**Oppgave:** Finkjem ALL compliance- og audit-relatert dokumentasjon.

**Områder:**
1. /Users/tobiashaugen/Projects/Spillorama-system/docs/compliance/ — alle .md-filer
2. /Users/tobiashaugen/Projects/Spillorama-system/docs/audit/ — alle .md-filer
3. Pengespillforskriften-relatert i docs/architecture/: SPILL_REGLER_OG_PAYOUT.md, SPILLKATALOG.md, QUARTERLY_ORG_DISTRIBUTION_DESIGN_2026-04-25.md
4. docs/operations/COMPLIANCE_INCIDENT_PROCEDURE.md, PAYOUT_REPORTING_AUDIT_2026-04-25.md, WALLET_RECONCILIATION_RUNBOOK.md

**Produser strukturert rapport (max 400 linjer):**
1. Regulatorisk grunnlag (§§ + Lotteritilsynet-relasjon + konsekvenser ved brudd)
2. Compliance-dokumenter (kategorisert: kritisk/viktig/referanse)
3. RNG-sertifisering (status, intern/ekstern)
4. Audit-historikk (kjørt + åpne)
5. Compliance-fallgruver (regelbrudd som har vært bugs)
6. Kritiske invariants per regel (immutable)
7. Pilot-gating-status (Lotteritilsynet)

Vær konkret med file-paths.
```

---

## Agent E — Engineering workflow research

```
Du er research-agent for å bygge en VANNTETT PM-onboarding-playbook for Spillorama-system. Ny PM må kunne overta uten å gjette på workflow-konvensjoner.

**Oppgave:** Finkjem alt som handler om engineering-prosess, PR-flyt, konvensjoner, ADR-prosess, og tekniske backlog.

**Områder:**
1. /Users/tobiashaugen/Projects/Spillorama-system/docs/engineering/ — alle .md-filer (32 stk)
2. /Users/tobiashaugen/Projects/Spillorama-system/docs/adr/ — README.md + 0001-0016
3. /Users/tobiashaugen/Projects/Spillorama-system/docs/decisions/README.md (KUN denne fila — gamle ADR-er er migrert til docs/adr/, IKKE les hele decisions/-mappa)
4. /Users/tobiashaugen/Projects/Spillorama-system/CLAUDE.md
5. /Users/tobiashaugen/Projects/Spillorama-system/.github/pull_request_template.md
6. /Users/tobiashaugen/Projects/Spillorama-system/.github/workflows/ — list og forstå CI-pipelines

**Produser strukturert rapport (max 400 linjer):**
1. PR-flyt (PM-sentralisert, ADR-0009)
2. ADR-prosess (når lage, format, lifecycle, migrering)
3. Engineering-konvensjoner (file naming, code naming, imports, TypeScript strict, test-struktur)
4. Tekniske backlog (TECHNICAL_BACKLOG, BACKLOG.md)
5. PM-orchestration-mønster (slots, worktrees, agent-rapport-format)
6. CI/CD-pipelines (workflows, blocking gates, schema-CI, migration-deploy)
7. Anti-mønstre fra historikken
8. Repo-struktur (apps/packages/legacy/infra)
```

---

## Agent F — Architecture deep-dive

```
Du er research-agent for å bygge en VANNTETT PM-onboarding-playbook for Spillorama-system. Ny PM må forstå kjerne-arkitekturen så grundig at hun ikke fraviker fra etablerte mønstre.

**Oppgave:** Dykk ned i de teknisk dypeste arkitektur-doc-ene som ikke allerede er auto-loaded i CLAUDE.md.

**Områder:**
1. /Users/tobiashaugen/Projects/Spillorama-system/docs/architecture/MODULES.md
2. /Users/tobiashaugen/Projects/Spillorama-system/docs/architecture/EVENT_PROTOCOL.md
3. /Users/tobiashaugen/Projects/Spillorama-system/docs/architecture/WIRE_CONTRACT.md
4. /Users/tobiashaugen/Projects/Spillorama-system/docs/architecture/SPILL_DETALJER_PER_SPILL.md
5. /Users/tobiashaugen/Projects/Spillorama-system/docs/architecture/SPILLORAMA_ROOM_STRUCTURE.md
6. /Users/tobiashaugen/Projects/Spillorama-system/docs/architecture/modules/ — alle filer
7. /Users/tobiashaugen/Projects/Spillorama-system/docs/architecture/MODULE_CATALOG_*.md (3 stk)
8. /Users/tobiashaugen/Projects/Spillorama-system/docs/architecture/CASINO_GRADE_ARCHITECTURE_RESEARCH_2026-04-28.md
9. /Users/tobiashaugen/Projects/Spillorama-system/docs/architecture/LIVE_CASINO_ROOM_ARCHITECTURE_RESEARCH_2026-04-27.md
10. /Users/tobiashaugen/Projects/Spillorama-system/docs/architecture/ANTI_FRAUD_ARCHITECTURE.md
11. /Users/tobiashaugen/Projects/Spillorama-system/docs/architecture/AUTO_RELOAD_RESILIENCE_SPEC_2026-04-30.md
12. /Users/tobiashaugen/Projects/Spillorama-system/docs/auto-generated/API_ENDPOINTS.md
13. /Users/tobiashaugen/Projects/Spillorama-system/docs/auto-generated/DB_SCHEMA_SNAPSHOT.md

**Produser strukturert rapport (max 500 linjer):**
1. System-modul-kart (backend-domener + frontend-pakker + boundaries)
2. Socket.IO event-katalog (kanonisk, idempotency-mønster, per-recipient broadcast)
3. Wire-contract (request/response, error-codes, payload-formater)
4. Per-spill-mekanikk (Spill 1, 2, 3, 4, Candy)
5. Casino-grade-arkitektur (mål, skala, server SoT, fail-closed)
6. Anti-fraud + auto-reload + lobby-arkitektur
7. Database-snapshot (tabeller, grupper)
8. API-endpoint-omfang (per tag, RBAC)
9. Candy-grense (hva eier vi vs Candy)
10. Per-modul-deep-dive
```

---

## Hvordan bruke disse promptene

```typescript
// I AI-PM-sesjonen, send som parallel tool-use:
const promptA = "Du er research-agent for å bygge..."  // (limt fra Agent A over)
const promptB = "..."
const promptC = "..."
// osv

// Spawn alle 6 i samme tool-use-block (parallell)
[
  Agent({ description: "Skills deep-dive", subagent_type: "Explore", prompt: promptA, run_in_background: true }),
  Agent({ description: "PM-historikk", subagent_type: "Explore", prompt: promptB, run_in_background: true }),
  Agent({ description: "Pilot-tests", subagent_type: "Explore", prompt: promptC, run_in_background: true }),
  Agent({ description: "Compliance", subagent_type: "Explore", prompt: promptD, run_in_background: true }),
  Agent({ description: "Engineering", subagent_type: "Explore", prompt: promptE, run_in_background: true }),
  Agent({ description: "Architecture", subagent_type: "Explore", prompt: promptF, run_in_background: true }),
]
```

Mens agentene jobber, les MASTER_README + SYSTEM_DESIGN_PRINCIPLES + forrige PM-handoff selv. Konsoliderer rapportene når alle er ferdig (~10-15 min).

---

## Maintenance

Oppdater promptene når:
- Nye sentrale skills legges til (Agent A)
- PM-handoff-historikk endrer struktur (Agent B)
- R-tiltak-listen endres (Agent C)
- Nye compliance-doc-er publiseres (Agent D)
- Engineering-konvensjoner endres (Agent E)
- Nye arkitektur-doc-er prioriteres (Agent F)
