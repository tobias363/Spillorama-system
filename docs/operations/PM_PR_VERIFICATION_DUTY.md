# PM PR-Verification Duty — Tobias-direktiv 2026-05-10

**Sist oppdatert:** 2026-05-10
**Eier:** Tobias Haugen
**Status:** Immutable direktiv — kan IKKE fravikes uten Tobias-godkjenning

> Tobias 2026-05-10:
> *"PM alltid må kontrollere og verifisere commits og at pull request i git
>  alltid blir verifisert at de går igjennom — man må ikke få failed pull
>  request. Dette er en av de viktigste jobbene til PM. Alt arbeid må
>  verifiseres og kontrolleres at alt er ok når det er pullet til Git."*

---

## Hva dette dokumentet er

Den autoritative beskrivelsen av PM-ens **ikke-forhandlbare** ansvar når det
gjelder PR-er, commits og CI-verifisering. Sammen med
[`docs/engineering/PM_ONBOARDING_PLAYBOOK.md`](../engineering/PM_ONBOARDING_PLAYBOOK.md)
og [`scripts/pm-checkpoint.sh`](../../scripts/pm-checkpoint.sh) utgjør dette
det "vanntette" laget i PM-prosessen.

---

## De fire ikke-forhandlbare PM-pliktene

### Plikt 1 — PRE-COMMIT: Verifiser ditt eget commit

**FØR** du committer:

- [ ] Du har passert pm-checkpoint-gate (`bash scripts/pm-checkpoint.sh --status` viser ✅)
- [ ] Du har lest endringene du er i ferd med å committe (`git diff --staged`)
- [ ] Du har ikke `git add -A`-et — du adder eksplisitt navngitte filer
- [ ] Commit-meldingen følger Conventional Commits (`feat(scope): ...`)
- [ ] Hvis arkitektur-endring: ADR er skrevet
- [ ] Hvis Tier-A-fil endret (compliance/wallet/RNG): vil du restate intent til Tobias først

Pre-commit-hooken (`.husky/pre-commit`) vil blokkere commit-en hvis:
- PM-gate ikke er gyldig (`node scripts/check-pm-gate.mjs --strict` returnerer exit 1)
- Lint-staged-regler feiler (skill-frontmatter, markdown-lenker, migration-naming, etc.)

### Plikt 2 — PRE-PR: Verifiser før du åpner PR

**FØR** du kjører `gh pr create`:

- [ ] Branchen din er rebasert på siste `origin/main`
- [ ] Lokal `npm run check` passerer (TypeScript strict)
- [ ] Lokal `npm test` passerer (eller kjent flaky tester er dokumentert)
- [ ] Hvis migration: testet lokalt med `npm --prefix apps/backend run migrate`
- [ ] Hvis compliance-endring: `npm run test:compliance` passerer
- [ ] PR-template er fullt utfylt
- [ ] Gate-marker er i PR-beskrivelsen (én av: `gate-confirmed:`, `Main-SHA i .pm-onboarding-confirmed.txt:`, `gate-bypass:`, `gate-not-applicable:`)

### Plikt 3 — POST-PR-OPEN: Verifiser CI **innen 10 minutter**

Etter `gh pr create` (eller `gh pr merge --auto`):

```bash
# Vent 5-10 min, deretter:
gh pr checks <PR-nummer>
```

- [ ] **Alle CI-jobs er grønne**
- [ ] Hvis noen er røde:
  - **Reell test-feil?** → fix lokalt, push på samme branch, vent ny CI-run
  - **INFRA-feil (timeout, network)?** → re-trigger workflow, NOTÉR at det var infra
  - **Auto-merge fyrer på falsk grønn?** → STOPP merge umiddelbart, root-cause-fix infra
- [ ] **Hvis ≥3 PR-er feiler samme måte:** infra-bug. Stopp alle merges, root-cause-fix først (per Tobias-direktiv 2.3).

### Plikt 4 — POST-MERGE: Verifiser CI på main **innen 15 minutter**

Etter PR er merget:

```bash
git checkout main && git pull --rebase --autostash

# Sjekk siste workflows på main:
gh run list --branch main --limit 10
```

- [ ] **Alle workflows på den nye main-commit er grønne**
- [ ] `pm-merge-verification.yml` har lukket grønt eller åpnet en GitHub Issue
- [ ] Hvis Issue åpnet (røde workflows):
  - Følg [`ROLLBACK_RUNBOOK.md`](./ROLLBACK_RUNBOOK.md) hvis prod-impact
  - Hvis ikke prod-impact: fix-PR med høy prioritet
  - **Lukk Issue-en med kommentar** som dokumenterer hva som ble gjort
- [ ] Hvis prod-deploy: smoke-test prod (`curl /health`, sjekk admin-portal)

---

## Hvorfor er dette så strengt?

Tidligere har vi hatt:

1. **PM-er som ikke leste handoffs** → samme spørsmål stilt flere ganger, samme fallgruver gått i
2. **PM-er som glemte CI-sjekk etter merge** → bugs til prod oppdaget av kunder
3. **PM-er som auto-merget på "grønn" CI som egentlig var INFRA-fail** → broken main
4. **PM-er som hopper over compliance-tester** → regulatorisk risiko

Hver av de fire pliktene over er direkte motgift mot et historisk problem.

---

## Anti-mønstre (FORBUDT)

❌ "Auto-merge fungerte, jeg trenger ikke sjekke CI" — feil. Auto-merge fyrer ved teknisk grønn, ikke ved riktig.

❌ "Det er bare en docs-PR, jeg trenger ikke gate-marker" — feil. Bruk `gate-not-applicable: docs-only` eksplisitt.

❌ `git commit --no-verify` uten dokumentert begrunnelse i commit-meldingen.

❌ `git push --force` på `main`. Ever.

❌ Lukke Issue fra `pm-merge-verification.yml` uten kommentar som beskriver hva som ble gjort.

❌ Stole på "siste PM gjorde det" — verifiser selv.

---

## Tilfeller hvor PM-gate ikke er nødvendig

Bruk `gate-not-applicable: <rolle>` i PR-beskrivelsen for:

- **Tobias selv** committer som tech-lead → `gate-not-applicable: tobias`
- **Auto-genererte commits** fra workflows (auto-doc, weekly-status etc.) → `gate-not-applicable: ci-bot`
- **Ren docs-PR** uten kode-impact → `gate-not-applicable: docs-only`
- **Hotfix etter prod-incident** → `gate-bypass: hotfix-incident-YYYY-MM-DD` + label `approved-pm-bypass`

Workflowen verifiserer `docs-only`, `dependabot`, `ci-bot` og `tobias` automatisk der det er mulig. Alle andre bypass/not-applicable-varianter krever label `approved-pm-bypass`. Dokumenter alltid begrunnelse. Tobias auditerer disse over tid.

---

## Verktøy

| Verktøy | Bruk |
|---|---|
| `bash scripts/pm-checkpoint.sh` | Kjør gate, produserer `.pm-onboarding-confirmed.txt` |
| `bash scripts/pm-checkpoint.sh --status` | Sjekk om gate er gyldig |
| `bash scripts/pm-checkpoint.sh --validate` | Exit 0/1 (BIN-PM-VT-PR sin variant) |
| `node scripts/check-pm-gate.mjs --status` | Status + bypass-info |
| `node scripts/check-pm-gate.mjs --strict` | Exit 1 hvis ikke valid (brukes av pre-commit) |
| `node scripts/check-pm-gate.mjs --log-public` | Append hash til public audit-log |
| `gh pr checks <nr>` | Sjekk CI-status på PR |
| `gh run list --branch main --limit 5` | Sjekk siste workflows på main |
| `gh issue list --label pm-action-required` | Se utestående PM-action-required-issues |

---

## Hva skjer hvis du bryter en plikt?

1. **Første gang:** Tobias retter med kommentar i handoff. Læring.
2. **Andre gang:** Eksplisitt notert i postmortem hvis incident oppstod.
3. **Tredje gang (samme PM):** Vurder om denne PM-en er rett rolle for prosjektet.

Brudd som forårsaker prod-incident: skriv postmortem (`docs/postmortems/`).

---

**Se også:**
- [`docs/engineering/PM_ONBOARDING_PLAYBOOK.md`](../engineering/PM_ONBOARDING_PLAYBOOK.md) §2.3, §3, §10
- [`scripts/pm-checkpoint.sh`](../../scripts/pm-checkpoint.sh) — gate-script (BIN-PM-VT)
- [`scripts/check-pm-gate.mjs`](../../scripts/check-pm-gate.mjs) — validator
- [`.github/workflows/pm-gate-enforcement.yml`](../../.github/workflows/pm-gate-enforcement.yml) — PR-blokker
- [`.github/workflows/pm-merge-verification.yml`](../../.github/workflows/pm-merge-verification.yml) — post-merge CI-watcher
- [`docs/operations/EMERGENCY_RUNBOOK.md`](./EMERGENCY_RUNBOOK.md) — hvis CI rød på main
- [`docs/operations/ROLLBACK_RUNBOOK.md`](./ROLLBACK_RUNBOOK.md) — rollback-prosedyre
- [`docs/.pm-confirmations.log`](../.pm-confirmations.log) — public audit-trail
