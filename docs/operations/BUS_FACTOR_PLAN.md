# Bus-Factor Plan — Spillorama-system

**Sist oppdatert:** 2026-05-10
**Eier:** Tobias Haugen
**Status:** Planlagt (ikke aktivert ennå — Tobias er fortsatt eneste reviewer)
**Trigger for å aktivere:** Se §4 under
**Relatert risiko:** [`docs/RISKS.md`](../RISKS.md) R-001

> **Til ny PM eller Tobias:** Dette er planen for å redusere "Tobias-er-eneste-
> reviewer"-risikoen NÅR team vokser eller hvis Tobias blir utilgjengelig
> over tid. Per i dag (2026-05-10) er Tobias eneste reviewer — det er
> akseptert risiko mens prosjektet er solo-drevet, men dokumentert her slik
> at planen finnes klar når situasjonen endrer seg.

---

## 1. Klassifisering — hva KAN delegeres vs hva KAN IKKE

Tre tier basert på hvor stor compliance-/regulatorisk-risiko det er forbundet
med endringen.

### Tier A — KAN ALDRI delegeres (Tobias-only forever)

Disse områdene har direkte regulatorisk konsekvens. Feil her kan koste
lisensen eller utløse Lotteritilsynet-rapportering.

| Område | Filpattern | Hvorfor |
|---|---|---|
| RNG-algoritme | `*RngService*`, `*draw-engine*` (deler) | GLI-19 / sertifiserings-kritisk |
| Compliance-laget | `apps/backend/src/compliance/` | Pengespillforskriften §11/§66/§71 |
| Wallet-kjerne | `apps/backend/src/wallet/Wallet*.ts`, outbox-pattern, hash-chain | Penger på linja, hash-chain integritet |
| Audit-trail | `AuditLogService.ts`, `wallet-audit-*` | Lotteritilsynet-sporbarhet |
| ADR-er etter accepted | `docs/adr/*.md` (immutable) | Definitions-forbehold |
| Pengespillforskriften-tolkning | `docs/compliance/`, skill `pengespillforskriften-compliance` | Tobias eier relasjon til Lotteritilsynet |
| Spillkatalog (slug ↔ kategori) | `docs/architecture/SPILLKATALOG.md`, `ledgerGameTypeForSlug.ts` | §11-distribusjons-prosent avhenger |
| Vendor-kontrakter | `docs/operations/VENDORS.md`, `secrets/*.template.md` | Kommersielt + juridisk |
| CODEOWNERS, branch-protection | `.github/CODEOWNERS`, repo-settings | Endring kan undergrave alle andre kontroller |

**Hvis Tobias er utilgjengelig og en Tier A-endring må gjøres:** vent. Selv
2-3 dager forsinkelse er akseptabelt sammenlignet med konsekvensen av feil
beslutning. Eneste unntak: aktiv P1-incident med kunde-impact, der følges
[`EMERGENCY_RUNBOOK.md`](./EMERGENCY_RUNBOOK.md) som gir PM begrenset autonomi.

### Tier B — KAN delegeres til godkjent backup-reviewer

Disse områdene krever erfaring og kontekst, men er ikke regulatorisk-kritiske.
Backup-reviewer må ha gått gjennom trenings-prosessen i §3.

| Område | Filpattern | Trenings-krav |
|---|---|---|
| Spill 1 master-flow + plan-runtime | `Game1*.ts`, `MasterActionService.ts`, `GamePlan*.ts` | Lest SPILL1_IMPLEMENTATION_STATUS, kjørt skill `spill1-master-flow` |
| Spill 2 perpetual loop | `Spill2*.ts`, `Game2*.ts` | Lest SPILL2_IMPLEMENTATION_STATUS, skill `spill2-perpetual-loop` |
| Spill 3 phase-state-machine | `Spill3*.ts`, `Game3*.ts` | Lest SPILL3_IMPLEMENTATION_STATUS, skill `spill3-phase-state-machine` |
| DB-migrations | `apps/backend/migrations/` | Lest skill `database-migration-policy`, naming-konvensjon |
| Live-rom-arkitektur | `BingoEngine.ts`, `PerpetualRoundService.ts` | Lest LIVE_ROOM_ROBUSTNESS_MANDATE, skill `live-room-robusthet-mandate` |
| Shared types / wire-format | `packages/shared-types/`, `openapi.yaml` | Lest WIRE_CONTRACT |
| CI / infrastruktur | `.github/workflows/`, `render.yaml`, `docker-compose.yml`, `.husky/` | Lest ENGINEERING_WORKFLOW |
| Skills | `.claude/skills/` | Lest SKILL_CREATION_METHODOLOGY |

### Tier C — KAN delegeres til ENHVER kvalifisert utvikler

Standard frontend, tester uten compliance-impakt, dokumentasjon, refactor
uten arkitektur-endring.

| Område | Filpattern | Krav |
|---|---|---|
| Game-client UI | `packages/game-client/src/ui/`, `pages/` | Standard React/Pixi-erfaring |
| Admin-web UI | `apps/admin-web/src/pages/` (utenom ops-konsoll) | Standard frontend-erfaring |
| Unit-tester (utenom compliance) | `*.test.ts` (utenom `compliance/`, `wallet/`) | Lest CONTRIBUTING.md |
| Docs-only-endringer | `docs/` (utenom adr/, compliance/) | Markdown-syntax + lenke-validering |
| Routine-fixes (typo, linter, formatting) | hele repoet | Standard PR-flyt |

---

## 2. Foreslått delegerings-tidslinje (når triggere oppfylles)

### Fase 1 — Solo (per i dag, 2026-05-10)
- Tobias eneste reviewer
- AI-agenter implementerer, PM koordinerer
- Akseptert risiko: dokumentert i RISKS.md R-001

### Fase 2 — Backup-reviewer for Tier C (når team utvides til 2 personer)
- Backup-reviewer godkjent for Tier C-endringer
- Fortsatt Tobias-only for Tier A og Tier B
- Trinn-for-trinn trening av backup på Tier B (se §3)

### Fase 3 — Backup for Tier B (etter 3 mnd Fase 2 + bevist Tier C-track-record)
- Backup-reviewer kan godkjenne Tier B etter Tobias-godkjenning av tier-promotering
- Tobias forblir Tier A-only

### Fase 4 — Multi-reviewer (når team er 3+ personer)
- Branch-protection aktiveres med "Require Code Owner review"
- CODEOWNERS oppdateres med team-handles per område
- Tobias-bottleneck eliminert for Tier B + C
- Tier A forblir Tobias + en sertifisert co-reviewer

---

## 3. Trenings-prosess for backup-reviewer

For å bli sertifisert backup-reviewer for et Tier B-område, må kandidaten:

### Steg 1 — Onboarding (felles for alle)
- [ ] Fullført `PM_ONBOARDING_PLAYBOOK.md` (60-90 min)
- [ ] Lest CONTRIBUTING.md, ENGINEERING_WORKFLOW.md, SECURITY.md
- [ ] Demonstrert forståelse av Tobias' immutable direktiver (§2 i playbook)

### Steg 2 — Domene-spesifikk fordypning
For hvert Tier B-område kandidaten ønsker å reviewere:
- [ ] Lest tilhørende `SPILL[1|2|3]_IMPLEMENTATION_STATUS.md` eller area-doc
- [ ] Kjørt tilhørende skill ende-til-ende
- [ ] Implementert minst 2 PR-er i området med Tobias-review
- [ ] Skrevet minst 1 ADR (eller co-skrevet) i området

### Steg 3 — Shadow-review-fase
- [ ] Reviewet 5+ Tobias-PR-er parallelt med Tobias og diskutert avvik
- [ ] Ingen falske godkjenninger (PR som senere måtte rolles)

### Steg 4 — Sertifisering
- Tobias gir eksplisitt grønt lys per område (ikke generell)
- Oppdater CODEOWNERS med kandidatens GitHub-handle for området
- Logg sertifisering i denne filens §6

---

## 4. Triggere for å aktivere planen

**Aktiver Fase 2 (Tier C-delegering) når:**
- Et nytt fast team-medlem er onboardet og passet Steg 1
- ELLER Tobias har vært utilgjengelig 5+ dager 2 ganger på 6 måneder

**Aktiver Fase 3 (Tier B-delegering) når:**
- Backup-reviewer har vært i Fase 2 i 3+ måneder
- ELLER pilot er skalert til 12+ haller (review-volum krever delegering)

**Aktiver Fase 4 (multi-reviewer + branch-protection) når:**
- 3+ team-medlemmer er sertifisert
- ELLER prosjektet skal selges/overføres til større organisasjon

---

## 5. Hvis Tobias plutselig er borte permanent

Verstefall-scenario. Ikke planlagt for, men:

1. **Umiddelbart (uke 1):**
   - PM tar over Tier C på autonomi (allerede mulig under EMERGENCY_RUNBOOK)
   - Tier B og A pauses — ingen merge på disse områdene
   - Stengt for nye features; kun bug-fix og incident-response
   - Kontakt selskapets juridiske representant (se Tobias' nærmeste pårørende
     hvis ingen formell organisasjon eksisterer)

2. **Uke 2-4:**
   - Engasjer ekstern compliance-konsulent for Tier A-review
   - Identifiser senior-utvikler som kan trenes opp (følg §3 forsert)
   - Vurder om prosjektet bør overdras til større operatør (Norsk Tipping?
     Annen lisensiert operatør?)

3. **Måned 2+:**
   - Gjennomfør faktisk overdragelse eller etabler ny tech-lead
   - Aktivér Fase 4 i planen

**Forberedelse i dag** (det Tobias kan gjøre nå for å redusere bus-faktor 1):
- [ ] Identifiser én bestemt person som vil ta over hvis nødvendig
- [ ] Del 1Password-vault med denne personen (read-only OK)
- [ ] Dokumenter eier-relasjon til selskapet (Nordicprofil) i juridisk dokument
- [ ] Test at backup-personen kan logge inn på Render dashboard
- [ ] Periodisk (årlig) "what if Tobias is gone"-øvelse

---

## 6. Logg over sertifiseringer

(Tom inntil Fase 2 er aktivert)

| Person | GitHub-handle | Tier B-områder sertifisert | Sertifisert dato | Status |
|---|---|---|---|---|
| _<ingen ennå>_ | | | | |

---

## 7. Review og oppdatering

- **Kvartalsvis:** Vurder om triggere i §4 er nådd
- **Ved hvert team-skifte:** Oppdater §6 sertifiseringer
- **Hvis Fase 4 aktiveres:** Oppdater CODEOWNERS, fjern bus-faktor-merknad

---

**Se også:**
- [`docs/RISKS.md`](../RISKS.md) — R-001 bus-faktor 1
- [`.github/CODEOWNERS`](../../.github/CODEOWNERS) — gjeldende reviewer-pattern
- [`STAKEHOLDERS.md`](./STAKEHOLDERS.md) — hvem som er involvert
- [`EMERGENCY_RUNBOOK.md`](./EMERGENCY_RUNBOOK.md) — hva PM kan gjøre autonomt under P1
- [`docs/engineering/PM_ONBOARDING_PLAYBOOK.md`](../engineering/PM_ONBOARDING_PLAYBOOK.md) — Tobias' immutable direktiver
