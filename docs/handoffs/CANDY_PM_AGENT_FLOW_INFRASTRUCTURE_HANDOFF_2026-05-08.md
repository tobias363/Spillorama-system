# Handoff til Candy-PM — agent-flow-infrastruktur

**Dato:** 2026-05-08
**Fra:** Spillorama-PM (Claude Opus 4.7)
**Til:** Candy-prosjekt-PM
**Formål:** Beskrive infrastruktur-tiltakene Spillorama implementerte 2026-05-08 for å gi agenter alt de trenger for å gjøre Evolution Gaming-grade-arbeid uten misforståelser. Candy-PM kan replikere det samme.

**Lese sammen med:**
- `docs/handoffs/CANDY_PM_PROJECT_SKILLS_HANDOFF_2026-05-08.md` (skills-relevans-vurdering)
- `docs/handoffs/SKILL_CREATION_METHODOLOGY_2026-05-08.md` (hvordan vi lagde skills)

Denne handoff fokuserer på **infrastruktur rundt skills** — det som gjør at skills + docs holder seg friske og at agenter har faktisk kontroll.

---

## 0. TL;DR

Skills + fundament-doc-er er nivå 1 av "agenten har info". Det dekker IKKE:

- 🔴 Skill peker på doc → doc er stale → agent får feil info
- 🔴 Agent leser doc → koden har endret seg uten doc-oppdatering → agent foreslår feil løsning
- 🔴 To agenter jobber samme område samtidig → konflikt
- 🔴 PR-review-overhead → manuelle gates blir flaskehals
- 🔴 Tribal knowledge i hodene våre → aldri dokumentert
- 🔴 Onboarding-tid for hver ny agent-sesjon

Vi løste disse med **8 infrastruktur-tiltak** i 2 tiers + 4 valgfrie tredjeparts-tjenester.

**Anbefaling for Candy-PM:** Implementer Tier 1 i den første uken (4-6 dev-dager). Det gir alle de største problemene løsning.

**Faktisk tidsbruk hos Spillorama 2026-05-08:** Tier 1+2 ble fullført parallelt på ~4 timer wall-clock (med 5-9 parallelle agenter i isolerte worktrees).

---

## 1. Tier 1 — Stor verdi, lavt arbeid (kjør NÅ)

Disse 5 tiltakene løser de største problemene og er rask å implementere.

### 1.1 Architecture lint via dependency-cruiser ⭐⭐⭐

**Tool:** [`dependency-cruiser`](https://github.com/sverweij/dependency-cruiser) — open-source, gratis.

**Hva det gjør:** Linter-regler som CI fanger arkitektur-brudd:
- Apps importerer ikke på tvers (kun via `packages/`)
- Wallet-mutation kun via `WalletAdapter`-interface
- Compliance-events kun via `ComplianceLedger`
- Plan-runtime-kode skiller fra scheduled-game-kode
- Sirkulære avhengigheter detected
- Deprecated moduler (eks. `themebingo*` / `game4*`) blokkeres

**Verdi:** Agenten kan ikke uten å vite det bryte arkitektoniske konvensjoner — CI rejekterer. Kompletterer skills (skill = veiledning, lint = håndhevelse).

**Estimat:** 1 dev-dag.

**Spillorama-implementasjon:** PR #1067, branch `feat/architecture-lint-dependency-cruiser`.
- 8 regler aktive
- 9 eksisterende sirkler baselinet i `.dependency-cruiser-known-violations.json` som tech-debt
- CI-integration via `.github/workflows/architecture-lint.yml`
- Doc: `docs/engineering/ARCHITECTURE_LINT.md`

**Lærdom:** Ikke ta i bruk regler som triggerer 100+ violations rett ut av boksen — du blokker hele teamet. Baseline existing violations, fanger NYE.

### 1.2 PR auto-checklist via Danger.js ⭐⭐⭐

**Tool:** [`danger-js`](https://danger.systems/js/) — open-source, gratis. Kjører i CI på hver PR.

**Hva det gjør:** Bot kommenterer på hver PR med spesifikke krav basert på filendringer:
- Hvis fundament-doc endres → "Sjekk om tilhørende skill må oppdateres"
- Hvis wallet-kode endres → "Wallet-outbox-pattern gjelder"
- Hvis core-flow-kode endres → linker til relevant fundament-doc
- Migration → "Idempotent CREATE/ALTER?"
- Compliance-kode → "§-referanse?"
- PR-tittel ikke Conventional Commits → **fail** (eneste merge-blokker)
- Kritisk kode uten test-endringer → warn

**Verdi:** Hver PR får automatisk kontekst-sensitiv checklist. Reviewer ser umiddelbart om noe kritisk er glemt.

**Estimat:** 1 dev-dag.

**Spillorama-implementasjon:** PR #1064, branch `feat/pr-auto-checklist-danger-js`.
- 9 regler aktive
- Bypass via `[skip-danger]` i PR-body
- Conventional-Commits-tittel-validering er ENESTE blocker (resten er warn/message)

**Lærdom:** Bare bruk `fail()` for noe så objektivt at bypass aldri trengs (PR-tittel-format). Alt annet → `warn()` eller `message()` så reviewer kan vurdere.

### 1.3 Auto-genererte arkitektur-artefakter ⭐⭐⭐

**Tool:** GitHub Action + bash-script som bruker eksisterende verktøy (`dependency-cruiser`, `openapi-typescript`, parser av migrations).

**Hva det gjør:** Genererer alltid-friske arkitektur-artefakter ved hver push til main:
- Module dependency-graph (mermaid)
- DB-skjema-snapshot (fra migrations)
- API-endpoints-katalog (fra openapi.yaml)
- Migration-historikk (kronologisk)
- Skills-katalog (alle SKILL.md med navn + description)
- Service-grenser (apps/ + packages/-struktur)

Output committed til `docs/auto-generated/` med `[skip ci]`-trigger-loop-prevention.

**Verdi:** Eliminer "doc er stale"-problemet. Agenten ser virkelig kode-state, ikke bare "slik ble det designet".

**Estimat:** 1-2 dev-dager.

**Spillorama-implementasjon:** PR #1066, branch `feat/auto-generated-architecture-docs`.
- 7 filer genereres (1100+ linjer)
- Script: `scripts/generate-architecture-docs.sh` (695 linjer, macOS bash 3.2-kompatibel)
- CI: `.github/workflows/auto-generate-docs.yml`
- CLAUDE.md utvidet med peker til `docs/auto-generated/` for current-state-lookups

**Lærdom:** Skript MÅ være idempotent + grasiøs ved manglende verktøy. Fail-soft, log warning.

### 1.4 Onboarding-script for ny agent-sesjon ⭐⭐

**Hva det gjør:** Bash-script som genererer 1-2-sider markdown-rapport med current state:
- Pågående refaktor-bølger
- Sist 10 commits til main
- Åpne pilot-blokkere
- Aktive PR-er + worktrees
- Sist oppdaterte skills
- Lese-først-liste

**Verdi:** Hver agent-sesjon starter med "her er state akkurat nå". Spar 15-30 min discovery per sesjon.

**Estimat:** 0.5 dev-dag.

**Spillorama-implementasjon:** PR #1063, branch `feat/agent-onboarding-script`.
- `scripts/agent-onboarding.sh` (258 linjer)
- Doc: `docs/engineering/AGENT_ONBOARDING.md`
- CLAUDE.md utvidet med onboarding-instruksjon
- Graceful degradation hvis `gh` CLI ikke tilgjengelig

**Lærdom:** Skript skal aldri throw — bruk `set -uo pipefail` (ikke `-e`), wrap kall i `2>/dev/null` med fallback-tekst. Tom seksjon får `_(ingen)_`.

### 1.5 ADR-template + systematisk flyt ⭐⭐

**Hva det gjør:**
- Standard ADR-template
- ADR-numbering i `docs/adr/0001-*.md`
- Hver design-beslutning som påvirker ≥ 2 agenter får ADR
- ADR-er kobles til skills (via "Relaterte ADR-er"-seksjon)

**Verdi:** Bevar "why" som er det som glir mest. Agent som rører området får ADR-historikk.

**Estimat:** 1 dev-dag for å migrere eksisterende ADR-er + retningslinje.

**Spillorama-implementasjon:** PR #1071, branch `feat/adr-systematic-structure`.
- 13 ADR-er migrert til ny struktur (`docs/adr/0001-*.md`)
- ADR-0001 selv-refererende om ADR-prosess
- 5 sentrale skills oppdatert med ADR-referanser
- CLAUDE.md utvidet med ADR-prosess
- PR-template ADR-checklist

**Lærdom:** Beholdt gamle filer i `docs/decisions/` med deprecation-banner — git-historikk overlever. Mapping-tabell i README.

---

## 2. Tier 2 — Stor verdi, medium arbeid

Etter Tier 1 er Tier 2 neste fase. Spillorama gjorde Tier 2 #7 + #8 sammen med Tier 1.

### 2.1 Code-search-index (Sourcegraph eller similar) ⭐⭐

**Tool:** [`sg`](https://sourcegraph.com/) (Sourcegraph CLI, OSS) eller [Cody](https://sourcegraph.com/cody) (deres AI-agent).

**Hva det gjør:** Lokal kode-søk-server som indekserer hele repoet med:
- Symbol-search ("hvor brukes X?")
- Cross-references
- Type-hierarchies
- Diff-search

**Verdi:** Agenten kan finne svar på "hvordan brukes X i kodebasen" uten å lese 20 filer. Reduserer context-bruk drastisk.

**Estimat:** 1 dev-dag oppsett. Gratis hvis self-hosted.

**Spillorama-status:** Ikke implementert ennå. Planlagt etter pilot.

### 2.2 Pre-commit hooks (husky + lint-staged) ⭐⭐

**Tool:** [`husky`](https://typicode.github.io/husky/) + [`lint-staged`](https://github.com/lint-staged/lint-staged) — open-source, gratis.

**Hva det gjør:** Kjører automatisk før hver commit:
- TypeScript strict på endrede filer
- Skill-frontmatter-validering
- Markdown-link-checker
- Migration-name-format-sjekk
- Large-binary-cap (1 MB)
- ESLint + prettier

**Verdi:** Agent kan ikke commite stuff som senere feiler i CI. Reduserer feedback-loop fra 5-10 min til umiddelbar.

**Estimat:** 0.5-1 dev-dag.

**Spillorama-implementasjon:** PR #1068, branch `feat/pre-commit-hooks-husky`.
- 8 hook-regler aktive
- 4 custom validators i `scripts/hooks/*.mjs`:
  - `validate-skill-frontmatter.mjs`
  - `check-markdown-links.mjs`
  - `validate-migration-name.mjs`
  - `check-large-binaries.mjs`
- Doc: `docs/engineering/PRE_COMMIT_HOOKS.md`

**Lærdom:** IKKE blokk på TypeScript-warnings — kun errors. IKKE kjør hele test-suite (for sakte). Behold `--no-verify`-mulighet for emergency.

### 2.3 Synthetic E2E-test for kritisk flyt ⭐⭐

**Tool:** Vitest eller Playwright + Docker-compose for isolated infra.

**Hva det gjør:** Test som simulerer full kritisk-path (eksempel for Spillorama: hall opens → master starter → spillere kjøper → trekninger → vinnere → master pauser → settlement). Kjøres pre-merge for endringer i kritiske paths.

**Verdi:** Fanger cross-system-bugs som unit-tester ikke ser.

**Estimat:** 3-5 dev-dager.

**Spillorama-implementasjon:** PR #1070, branch `feat/synthetic-e2e-test-spill1`.
- 14 test-cases (575 LoC)
- Isolated PG/Redis på 5433/6380 med tmpfs
- CI: path-filtered (kjører kun ved relevante endringer)
- Doc: `docs/engineering/E2E_TESTS.md`
- **Verdi-bevis:** Testen oppdaget en ekte bug (BIN-824 — `/api/auth/me` krasjer for nyregistrerte) under bygging.

**Lærdom:** E2E-tester finner faktiske bugs ingen unit-test så. Verdt investeringen.

---

## 3. Tier 3 — Medium verdi, stor investering (skip nå)

Disse er overkill for de fleste prosjekter. Spillorama valgte å skippe begge.

### 3.1 Vector-DB + RAG for prosjekt-kunnskap ⭐
**Tool:** `qdrant` (OSS) + custom RAG, eller Sourcegraph Cody.
**Estimat:** 5-7 dev-dager.
**Risiko:** Kan introdusere ny error-mode (RAG halusinerer).

### 3.2 Knowledge graph (Neo4j) ⭐
**Hva:** Connect Code ↔ Tests ↔ Docs ↔ Skills ↔ ADR ↔ Issues.
**Estimat:** 7-10 dev-dager.
**Vurdering:** Stor for komplekse spørringer. Overkill for de fleste use-cases.

---

## 4. Tier 4 — Tredjepart-løsninger som kan vurderes

Spillorama anbefaler Tobias selv tar disse — koster lite, gir umiddelbar verdi.

### 4.1 [CodeRabbit](https://coderabbit.ai/) — AI PR-review
- Pris: ~$15/dev/måned
- Verdi: Automatisk AI-review på hver PR. Forslag til improvements.
- **Spillorama-anbefaling:** Installer FØRST — billig, immediate verdi, zero opplæring.

### 4.2 [Sourcegraph Cody](https://sourcegraph.com/cody) Enterprise
- Pris: $9-19/dev/måned
- Verdi: Integrert AI med kode-context.
- **Spillorama-anbefaling:** Etter CodeRabbit har bevist seg.

### 4.3 [Linear Agents](https://linear.app/) (allerede tilgjengelig?)
- Linear har AI-agent-integrasjon. Kan brukes for issue-triagering.
- **Spillorama-anbefaling:** Hvis du har Linear, prøv først.

### 4.4 [GitHub Copilot Workspace](https://github.com/features/copilot)
- Pris: $20/dev/måned
- Strukturert AI-utviklings-flow direkte i GitHub.
- **Spillorama-anbefaling:** Sist — overlapper mest med Claude Code.

---

## 5. Anbefalt eksekverings-rekkefølge for Candy-PM

### Uke 1 — Tier 1 (4-6 dev-dager)

Spawn 5 parallelle agenter i isolerte worktrees:

| Dag | Tiltak | Branch |
|---|---|---|
| 1-2 | Architecture lint | `feat/architecture-lint` |
| 1-2 | PR auto-checklist | `feat/pr-auto-checklist` |
| 2-3 | Auto-genererte artefakter | `feat/auto-generated-docs` |
| 1 | Onboarding-script | `feat/agent-onboarding-script` |
| 2-3 | ADR-systematisering | `feat/adr-systematic-structure` |

Mergerekkefølge: parallell, alle uten konflikt-risk hvis hver er i eget worktree.

### Uke 2 — Tier 2 + Tredjeparts (8-10 dev-dager)

| Dag | Tiltak |
|---|---|
| 1 | Pre-commit hooks (Tier 2 #2) |
| 2-4 | E2E-test for kritisk Candy-flow (Tier 2 #3) |
| 5 | Sourcegraph CLI oppsett (Tier 2 #1, hvis ønsket) |
| 5 | CodeRabbit-installasjon (Tier 4 #1) |

### Uke 3+ — Pilot

Etter Tier 1+2 er på plass har Candy-PM Evolution-grade-fundament. Pilot-readiness avhenger så av domain-spesifikk arbeid.

---

## 6. Lærdommer fra Spillorama 2026-05-08

### Hva som fungerte godt

1. **Parallelle agenter i isolerte worktrees** — 9 agenter samtidig, ingen kollisjon
2. **Detaljerte agent-mandater** (~3000 ord per prompt) — gir konsistent kvalitet
3. **Code-reviewer-gate** for kritiske endringer (Bølge 1 + Bølge 2 av plan↔spill-refaktor) — fanget bugs
4. **PR-first med admin-merge** for docs-only-PR-er som hang på CI-flake
5. **Branch-isolering** — selv om main ble overhalt med 11 PRs på én sesjon, ingen merge-konflikter på selve worktree-arbeidet (kun package.json-conflicts som var rebase-trivielle)

### Fallgruver

1. **package.json-conflicter** når flere agenter legger til devDependencies parallelt — løses med rebase + `npm install` per branch
2. **Stille agenter** — én agent kan crashe silently uten output. Rollback + re-spawn med eksplisitt anti-stille-mandat
3. **Worktree-cleanup** — `git worktree remove --force` mens agent fortsatt har lock → manuell cleanup etterpå
4. **CI-flakes på docs-only PR-er** — wallet-tx race-conditions i parallel test execution. Admin-merge er trygt for ren markdown
5. **Skill-name-kollisjoner** — eks. `MasterActionResult` brukt av 2 services. Sjekk navn-reservasjon FØR du starter

### Tid-investering

| Aktivitet | Wall-clock | Agent-timer |
|---|---|---|
| 20 skills opprettet (3 batches) | ~1.5t | 3 × 30-60min |
| Tier 1 (5 tiltak) | ~1.5t | 5 × 30-90min |
| Tier 2 #7+#8 | ~1.5t | 2 × 60-120min |
| Bølge 1+2+6 fundament-refaktor | ~3t | 3 × 60-120min |
| **Total parallelt** | **~4-5t wall-clock** | ~30-40 agent-timer |

---

## 7. Konkret start-sjekkliste for Candy-PM

### Dag 0 — Forberedelser

- [ ] Identifiser autoritative fundament-doc-er i Candy-prosjektet
- [ ] Sjekk hvilke ADR-er finnes
- [ ] Inventar nåværende `.claude/skills/` (om noen)
- [ ] Verifiser tilgang til repo + Linear + CI

### Dag 1 — Tier 1 launch

- [ ] Spawn architecture-lint-agent
- [ ] Spawn PR-auto-checklist-agent
- [ ] Spawn auto-generated-docs-agent
- [ ] Spawn onboarding-script-agent
- [ ] Spawn ADR-systematisering-agent

### Dag 2-3 — Merge + verifisering

- [ ] Code-review hver tier-1 PR
- [ ] Admin-merge etter review
- [ ] Test at CI fanger arkitektur-brudd (lag bevisst-violation-PR, sjekk at den blokkeres)
- [ ] Test at PR-bot kommenterer
- [ ] Kjør onboarding-script lokalt — verifiser output

### Dag 4-5 — Tier 2 start

- [ ] Spawn pre-commit-hooks-agent
- [ ] Spawn E2E-test-agent

### Uke 2

- [ ] Aktiver CodeRabbit
- [ ] Vurder Sourcegraph CLI
- [ ] Integrer Linear Agents

---

## 8. Spørsmål Candy-PM bør svare først

1. **Hvilke arkitektoniske konvensjoner skal håndheves?** Lag liste før du konfigurerer architecture-lint.
2. **Hvilke kritiske kode-områder skal Danger.js sjekke?** Lag liste over (file-pattern → reminder-tekst).
3. **Hvilke artefakter er mest verdifulle å auto-generere?** Velg 3-5 mest verdifulle.
4. **Hva er Candy's "kritiske flyt" for E2E?** Definer happy path før du bygger.
5. **Hvilke ADR-er finnes allerede, men ikke som ADR-format?** Inventar.

---

## 9. Kontakt-punkt

Hvis Candy-PM trenger:
- Å se Spillorama's konkrete agent-prompts → kontakt PM, kan dele
- Å se faktiske skill-filer / docs / runbooks → `<spillorama-repo>/.claude/skills/`, `<spillorama-repo>/docs/`
- Å diskutere arkitektur-grenser → Tobias

---

## 10. Endringslogg

| Dato | Endring |
|---|---|
| 2026-05-08 | Initial. Dokumentert etter Spillorama implementerte Tier 1+2 på én dag (~5t wall-clock med 9 parallelle agenter). |
