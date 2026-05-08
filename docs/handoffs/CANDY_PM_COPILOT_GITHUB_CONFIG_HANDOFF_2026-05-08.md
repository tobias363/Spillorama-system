# Handoff til Candy-PM — GitHub Copilot + GitHub-config

**Dato:** 2026-05-08
**Fra:** Spillorama-PM (Claude Opus 4.7)
**Til:** Candy-prosjekt-PM
**Formål:** Beskrive nøyaktig hvordan Spillorama integrerte GitHub Copilot (gratis aktivering) + konfigurerte GitHub-repository-settings for å gi agenter (både Claude Code og Copilot) optimalt fundament.

**Lese sammen med:**
- `docs/handoffs/CANDY_PM_PROJECT_SKILLS_HANDOFF_2026-05-08.md` (skills-relevans)
- `docs/handoffs/SKILL_CREATION_METHODOLOGY_2026-05-08.md` (skills-metodologi)
- `docs/handoffs/CANDY_PM_AGENT_FLOW_INFRASTRUCTURE_HANDOFF_2026-05-08.md` (Tier 1-4 infra)

Denne handoff er **konkret oppskrift** — hvilke filer å lage, hvilke API-kall å kjøre, og hvordan dele tilgang trygt med PM-AI.

---

## 0. TL;DR

**Tidsbruk hos Spillorama:** ~30 min wall-clock for begge stegene.

**To steg:**

| Steg | Innhold | Krever PAT? |
|---|---|---|
| **Steg 1** | `.github/copilot-instructions.md` | Nei (vanlig commit-rights) |
| **Steg 2** | Branch-protection + CODEOWNERS + repo-settings + topics | **Ja** (PAT med admin) |

**Anbefalt rekkefølge:** Steg 1 først (umiddelbar Copilot-verdi). Steg 2 når du er klar til å låse main.

---

## 1. Steg 1 — Copilot-instructions (uten PAT)

### Hva det er

`.github/copilot-instructions.md` er en markdown-fil GitHub Copilot leser FØR den foreslår kode. Tilsvarer CLAUDE.md, men for Copilot.

**Hvor Copilot leser den:**
- Copilot Chat (i VS Code, JetBrains, Visual Studio)
- Copilot Code Suggestions (autocomplete)
- Copilot for PR-review (hvis aktivert)

### Effekt

Når noen bruker Copilot i prosjektet, får suggestions som:
- Respekterer arkitektoniske konvensjoner (no cross-app imports, WalletAdapter-pattern)
- Bruker riktig id-rom (Bølge 1+2+3-refaktorens single-id-regel)
- Følger pengespillforskriften (cap kun for databingo, etc.)
- Unngår deprecated patterns (themebingo, console.log, etc.)
- Peker på fundament-doc-er ved tvil

### Format-spec

```markdown
# Project Instructions for GitHub Copilot

## Project Overview

[Kort prosjekt-beskrivelse]

## Tech Stack

[Tabell med tech + versjoner]

## 🚨 Read-First Rules

[Kritiske blokker som speiler CLAUDE.md sine 🚨-blokker]

## Architectural Conventions

[Konvensjoner som Copilot må respektere]

## Game Catalog Quick Reference

[For å forhindre forvirring mellom spill]

## Critical ID Disambiguation

[Etter Bølge 1+2+3-refaktoren — `currentScheduledGameId` er ENESTE id for master-actions]

## Testing Conventions

[Hvordan tester skrives + hvilke verktøy]

## Commit Conventions

[Conventional Commits-format]

## Code Style

[Naming, imports, file-structure]

## Regulatoriske Punkter

[§-paragrafer som må respekteres]

## Deprecated Patterns

[Patterns Copilot skal IKKE foreslå]

## When in Doubt

[Pekers på autoritative docs]
```

### Spillorama-implementasjon

- **PR #1076** — `.github/copilot-instructions.md` (389 linjer)
- **Doc:** `docs/engineering/GITHUB_COPILOT_GUIDE.md` (186 linjer)
- **Branch:** `chore/github-copilot-instructions`

### Anbefaling for Candy-PM

Spawn en agent med samme mandate som vi brukte:

```
Agent({
  description: "GitHub Copilot instructions for Candy",
  isolation: "worktree",
  prompt: `
    Lag .github/copilot-instructions.md for Candy-prosjektet.
    
    Speil [Candy CLAUDE.md] men i Copilot-format:
    - 🚨 Read-first rules som peker på Candy's fundament-docs
    - Architectural conventions (Spillorama-host-integration, etc.)
    - Tech stack quick-reference
    - Game catalog (Candy-spill)
    - Deprecated patterns (om noen)
    - When in doubt: peker på autoritative docs
    
    300-600 linjer.
  `
})
```

### Estimat

30-60 min wall-clock.

### Krav til access

- Skrive-rights til repo (vanlig push)
- INGEN PAT nødvendig

---

## 2. Steg 2 — GitHub-repo-config (krever PAT)

### Hva det dekker

| Tiltak | API-endepunkt | Effekt |
|---|---|---|
| Branch-protection | `PUT /repos/{o}/{r}/branches/{b}/protection` | Required status checks må passere før merge |
| Repo-settings | `PATCH /repos/{o}/{r}` | Kun squash-merge, delete-on-merge, auto-merge |
| Repository topics | `PUT /repos/{o}/{r}/topics` | Søkbare tags |
| Description | (samme som settings) | Profilerer repo |
| CODEOWNERS-fil | Vanlig commit | Auto-assign reviewer |

### Hvorfor PAT trengs

GitHub OAuth-tokens (fra `gh auth login --web`) har `repo`-scope, men spesifikke admin-endpoints (eks. `branches/{b}/protection`) krever at brukeren faktisk er **repo admin**. Hvis aktiv `gh auth`-bruker ikke er admin, vil API returnere `404 Not Found` (security-by-obscurity).

**Spillorama-tilfelle:** Vi hadde to gh-accounts (`tobias50` og `tobias363`). Repoet eies av `tobias363` (admin), men `gh` var aktivert som `tobias50`. Løste med `gh auth switch --user tobias363`.

### Lag fine-grained PAT

#### Steg-for-steg på GitHub

1. Profile (øverst høyre) → **Settings**
2. Sidebar nederst → **Developer settings**
3. **Personal access tokens** → **Fine-grained tokens** → **Generate new token**

#### Token-konfigurasjon

| Felt | Verdi |
|---|---|
| Token name | `Candy Claude PM YYYY-MM-DD` |
| Expiration | **30 days** (regenerer når trengs) |
| Description | "PM-agent setter opp branch-protection + CODEOWNERS" |
| Resource owner | Bruker som eier Candy-repoet |
| Repository access | **Only select repositories** → velg KUN Candy-repoet |

#### Permissions (kun disse)

**Repository permissions:**
- ✅ **Administration:** Read and write (for branch-protection)
- ✅ **Contents:** Read and write
- ✅ **Metadata:** Read-only (auto-required)
- ✅ **Pull requests:** Read and write
- ✅ **Workflows:** Read and write (for required status checks)
- ✅ **Webhooks:** Read and write (hvis du skal sette opp CodeRabbit)

**Account permissions:** ALLE skal være "No access".

### Dele PAT trygt med PM-AI

#### Alt 1 — `gh auth switch` (anbefalt hvis du har eksisterende auth)

```bash
gh auth switch --user <repo-eier-konto>
```

#### Alt 2 — Eksporter PAT som miljøvariabel

```bash
export GH_TOKEN="github_pat_xxxxx..."
cd <repo-rot>
# Start claude code som vanlig
```

#### Alt 3 — `.env`-fil

```bash
echo 'GH_TOKEN=github_pat_xxxxx...' >> .env
```

(`.env` skal være gitignored — verifiser FØRST.)

### Konfigurere repo (PM-AI gjør)

#### A. Branch-protection

```bash
cat <<'EOF' > /tmp/branch-protection.json
{
  "required_status_checks": {
    "strict": false,
    "contexts": ["backend", "compliance", "lint-blink-hazards", "admin-web"]
  },
  "enforce_admins": false,
  "required_pull_request_reviews": null,
  "restrictions": null,
  "required_linear_history": false,
  "allow_force_pushes": false,
  "allow_deletions": false
}
EOF

gh api -X PUT repos/{owner}/{repo}/branches/main/protection --input /tmp/branch-protection.json
```

Tilpass `contexts` til CI-jobbene som finnes i Candy-repoet.

#### B. Repo-settings

```bash
gh api -X PATCH repos/{owner}/{repo} \
  -f description="<Candy beskrivelse>" \
  -F allow_merge_commit=false \
  -F allow_rebase_merge=false \
  -F allow_squash_merge=true \
  -F delete_branch_on_merge=true \
  -F allow_auto_merge=true
```

#### C. Topics

```bash
gh api -X PUT repos/{owner}/{repo}/topics --input - <<'EOF'
{
  "names": ["candy", "iframe-game", "typescript", ...]
}
EOF
```

#### D. CODEOWNERS-fil

Plassering: `.github/CODEOWNERS`

Mal (basert på Spillorama):

```
# Default
* @candy-team

# Regulatorisk (om relevant)
/src/regulatory/ @candy-team

# Wallet-bridge (kritisk)
/src/wallet-bridge/ @candy-team

# Gameplay-engine
/src/engine/ @candy-team

# CI/Infra
/.github/workflows/ @candy-team
/render.yaml @candy-team

# Fundament-doc-er
/docs/architecture/ @candy-team
/docs/adr/ @candy-team
/CLAUDE.md @candy-team
/.github/copilot-instructions.md @candy-team
```

Erstatt `@candy-team` med faktisk team-handle eller @-bruker.

### Spillorama-implementasjon

- **PR #1078** — CODEOWNERS-fil (135 linjer)
- **Branch:** `chore/codeowners`
- **API-kall direkte** (ikke i PR): branch-protection, repo-settings, topics

### Estimat

30 min wall-clock (etter PAT er på plass).

---

## 3. Verifisering etter konfig

### Sjekk branch-protection

```bash
gh api repos/{owner}/{repo}/branches/main/protection --jq '{required_status_checks, allow_force_pushes, allow_deletions}'
```

Forventet: status checks listet, force-push false, deletions false.

### Sjekk repo-settings

```bash
gh api repos/{owner}/{repo} --jq '{allow_squash_merge, allow_merge_commit, allow_rebase_merge, delete_branch_on_merge, topics}'
```

### Test branch-protection

```bash
# Push en branch direkte til main (skal blokkeres)
git push origin main:test-direct-push  # Burde feile på protection
```

### Test PR-flow

Åpne en test-PR. Verifiser at:
- Required status checks vises som blockers
- Auto-merge er tilgjengelig
- CODEOWNERS auto-tagger reviewer

---

## 4. Lærdommer fra Spillorama 2026-05-08

### Hva fungerte godt

1. **Fine-grained PAT med kort utløp (30 dager)** — minimerer blast-radius hvis lekket
2. **`gh auth switch`** istedenfor å håndtere PAT manuelt — mer ergonomisk
3. **CODEOWNERS i samme PR som branch-protection** — atomisk endring av merge-flow
4. **`required_pull_request_reviews: null`** — beholder Tobias' git-workflow uten å påtvinge review-approval

### Fallgruver

1. **Multi-account-shells** — `gh` kan ha flere auth-accounts. Sjekk `gh auth status` FØRST.
2. **404 vs 403** — GitHub returnerer 404 (ikke 403) når token mangler permissions. Misvisende. Bruk `gh api repos/{o}/{r} --jq .permissions` for å sjekke faktisk admin-rolle.
3. **Topics-syntaks** — `gh api -X PUT repos/.../topics -f names[]=x` virker IKKE. Bruk `--input` med JSON-fil eller `<<EOF`.
4. **Branch-protection + bestående PR-er** — settings gjelder umiddelbart. Hvis du har åpne PR-er som ikke møter krav, må de re-rebases.

### Tid-investering

| Aktivitet | Wall-clock |
|---|---|
| Steg 1 (Copilot-instructions agent) | 30-60 min |
| Steg 2 (PAT + API-kall + CODEOWNERS) | 30 min |
| Verifisering | 10 min |
| **Total** | **~1.5 time** |

---

## 5. Spørsmål Candy-PM bør svare først

1. **Hvilken konto eier Candy-repoet?** Switch til den med `gh auth switch` FØR du gir PAT.
2. **Hvilke CI-jobber finnes i Candy-repoet?** Trengs for å konfigurere required status checks korrekt.
3. **Skal Candy ha review-required?** Spillorama har null required reviewers (PM-eier-merge-modell). Candy kan ha annen.
4. **Hvilke paths er kritiske for CODEOWNERS?** Lag liste FØR PAT-tilgang gis.

---

## 6. Resultat — slik ser Spillorama ut nå

```
Repository: tobias363/Spillorama-system
Description: Live bingo platform for the Norwegian market — Spill 1-3 hovedspill + SpinnGo databingo + Candy iframe-integration. Regulated under pengespillforskriften.
Topics: bingo, norwegian, pengespill, typescript, nodejs, socketio, postgresql, redis, evolution-gaming-grade

Branch protection (main):
  Required status checks: backend, compliance, lint-blink-hazards, admin-web
  Force pushes: blocked
  Deletions: blocked
  
Merge methods:
  ✓ Squash merge
  ✗ Merge commit
  ✗ Rebase merge

Auto-merge: enabled
Delete branch on merge: enabled

CODEOWNERS: 135 linjer, dekker compliance, wallet, audit, Game1/2/3,
fundament-docs, CI/infra, shared-types, ops/DR, skills.

.github/copilot-instructions.md: 389 linjer som speiler CLAUDE.md
i Copilot-vennlig format.
```

---

## 7. Kontakt-punkt

- Spørsmål om Spillorama's eksakte API-kall → kan dele bash-history
- Spørsmål om Copilot-instructions-format → se `docs/engineering/GITHUB_COPILOT_GUIDE.md`
- PAT-permissions-tvil → se §2 over

---

## 8. Endringslogg

| Dato | Endring |
|---|---|
| 2026-05-08 | Initial. Spillorama implementerte Steg 1+2 på ~1.5t wall-clock. PR #1076 (Copilot-instructions) + #1078 (CODEOWNERS). |
