# Knowledge Autonomy Protocol — vanntett selv-forbedrende kunnskap

**Status:** Autoritativ. Skal være lese-først-i-sesjon for alle PM-AI.
**Etablert:** 2026-05-13
**Eier:** Tobias Haugen
**Tobias-direktiv 2026-05-13:**
> "Det må bli vanntett nå ellers vil det ikke funke. Kan du anbefale noe annet her for at dette skal gå av seg selv og at da agentene blir smartere utifra arbeid som blir gjort fordi dokumentasjon alltid oppdateres?"

---

## 0. Hvorfor dette dokumentet eksisterer

Vi har samlet 4 kunnskaps-artefakter (PITFALLS_LOG, FRAGILITY_LOG, BUG_CATALOG, AGENT_EXECUTION_LOG) + monitor + ConsoleBridge + skill-katalog. Men hver komponent er manuell — vi stoler på at PM/agenter "husker" å oppdatere. Erfaring viser at de glemmer.

Dette dokumentet beskriver det **vanntette enforcement-systemet** som gjør kunnskap selv-forbedrende:

1. Pre-work: agent får automatisk kontekst-pack
2. During-work: live-monitor logger alt som skjer
3. Post-work: obligatorisk delta-rapport blokkerer PR uten den
4. Cross-cycle: lærdom akkumulerer per agent uten PM-intervensjon

---

## 1. De 7 kunnskaps-pilarene

| # | Pilar | Manuell/Auto | Eier |
|---|---|---|---|
| 1 | **PITFALLS_LOG.md** — fallgruver per domene | Manuell | PM oppdaterer per fix |
| 2 | **FRAGILITY_LOG.md** — file:line → "ikke-rør-uten-å-verifisere"-regler | Manuell | PM oppdaterer per bug |
| 3 | **BUG_CATALOG.md** — alle E2E-bugs spores | Manuell | Agent oppdaterer per leveranse |
| 4 | **AGENT_EXECUTION_LOG.md** — agent-arbeid + learnings | Manuell | Agent oppdaterer per leveranse |
| 5 | **Skills (`.claude/skills/*/SKILL.md`)** — domene-kunnskap + scope-glob-mapping | Manuell + Auto | PM oppdaterer skill-innhold; scope-headers auto-pickes av context-pack |
| 6 | **Live-monitor** + **ConsoleBridge** — runtime-observability | Automatisk | Monitor-agent kjører kontinuerlig |
| 7 | **scripts/generate-context-pack.sh** — auto-brief per agent-spawn (inkl. skills via scope-glob) | Automatisk | Kjøres av PM før spawn |

---

## 2. Den vanntette flyten (per agent-leveranse)

### Step 1 — PM spawn agent

PM kjører **først**:
```bash
bash scripts/generate-context-pack.sh "<file-pattern>" > /tmp/agent-context.md
```

Output inkluderer:
- FRAGILITY-entries som dekker filer i scope
- PITFALLS-seksjoner for relevante domener
- Siste 3 AGENT_EXECUTION-entries på samme scope
- Åpne PR-er som rører samme filer
- Påkrevd lese-bekreftelse-mal

PM inkluderer hele context-pack-en i agent-prompten under en `## Context Pack (mandatory read)`-seksjon.

### Step 2 — Agent leser og bekrefter

Agent **MÅ** først i sin første commit-message inkludere lese-bekreftelse:
```
[skills-read: <skill-navn eller "none">]
[context-read: F-NN, F-NN]
[pitfalls-read: §1, §3]
[prior-agent-brief: <SHA av siste relevante agent-commit eller "none">]
```

Pre-commit hook validerer at disse markørene finnes i commit-message. Mangler de → commit blokkert.

### Step 3 — Live-monitor observerer

Mens agent jobber:
- Monitor poller `/api/_dev/debug/events/tail` hvert 5 sek
- ConsoleBridge pusher klient-konsoll-events til server-buffer
- Anomalier loggføres til `/tmp/pilot-monitor.log`
- 60s-snapshots oppdateres `/tmp/pilot-monitor-snapshot.md`

Hvis monitor detekterer anomali (popup ikke vises, wallet-feil, stuck state), PM kan stoppe agent-en og prøve på nytt med mer presis instruksjon.

### Step 4 — Agent oppdaterer kunnskap som del av leveranse

Agent MÅ commit-e (ikke valgfritt) oppdateringer til:
- `BUG_CATALOG.md` hvis bug avdekket
- `AGENT_EXECUTION_LOG.md` med entry for seg
- `FRAGILITY_LOG.md` hvis ny fragility oppdaget
- `PITFALLS_LOG.md` hvis ny fallgruve

Format-mal for hver er dokumentert i respektive filer.

### Step 5 — Delta-rapport blokkerer PR

Hver PR som rører pilot-relatert kode MÅ inkludere `docs/delta/<YYYY-MM-DD-HHMM>-<branch>.md` med:

```markdown
# Delta-rapport — <agent-id> / <branch>

## Hva ble endret
- file:line refs

## Hva andre steder kunne ha blitt brutt
- (proaktiv risiko-analyse)

## Nye fragilities oppdaget
- F-NN-IDs (eller "ingen")

## Brief for neste agent som rører samme område
- "Hvis du endrer X, husk at Y avhenger av Z"

## Tester som ble kjørt + status
- pilot-flow: ✅ / ❌
- unit-tests: ✅ / ❌
- manuell verifikasjon: ✅ / ❌ / N/A
```

Danger-rule blokkerer PR uten delta-rapport.

### Step 6 — PM godkjenner og merger

PM verifiserer:
1. Delta-rapport finnes og er konkret
2. Kunnskaps-pilarer oppdatert (PITFALLS / FRAGILITY / BUG_CATALOG / AGENT_LOG)
3. CI grønn (inkludert pilot-flow E2E)

Først da auto-merge aktiveres.

### Step 7 — Akkumulert lærdom

Etter merge:
- Neste agent som spawnes for samme scope får context-pack med DENNE leveransen som siste prior-agent-brief
- FRAGILITY-entries linker tilbake til denne PR-en som "Historisk skade"
- PITFALLS-entries krediteres til agenten

Kunnskapen er nå **flytende og selv-forbedrende**.

---

## 2b. Skill-til-fil-mapping (Pilar 5 + 7, koblet)

Hver skill (`.claude/skills/<name>/SKILL.md`) har en **scope-header** rett etter YAML-frontmatteren:

```markdown
---
name: spill2-perpetual-loop
description: ...
---

<!-- scope: apps/backend/src/game/Game2*, apps/backend/src/game/Spill2*, apps/backend/src/game/PerpetualRound*, packages/game-client/src/games/game2/** -->

# Spill 2 — Perpetual room loop og auto-tick
```

Scope-globber bruker shell-glob (`*` = single-segment, `**` = recursive). Komma separerer flere mønstre.

**Hvorfor:** når en agent rører `apps/backend/src/game/Game2Engine.ts`, skal `spill2-perpetual-loop`-skill alltid lastes — uten at PM må huske det manuelt. Scope-mapping er det vanntette koblings-leddet mellom **hvilken fil agent rører** og **hvilken domene-kunnskap som er invariant**.

### Verktøy

| Script | Hva | Når kjøres |
|---|---|---|
| `scripts/find-skills-for-file.mjs <file>` | Print skills som matcher gitt file | Manuelt + av context-pack-generator |
| `scripts/build-skill-file-map.mjs` | Generer `docs/auto-generated/SKILL_FILE_MAP.md` | Hver gang scope endres — pre-commit + CI |
| `scripts/generate-context-pack.sh <pattern>` | Auto-brief inkluderer matching skills som seksjon 1 | Hver agent-spawn |
| `.github/workflows/skill-mapping-validate.yml` | Validerer scope-headers på PR. Stale SKILL_FILE_MAP er nå **warning**, ikke blokker (siden 2026-05-13) — auto-regen kjører post-merge | Hver PR til main |
| `.github/workflows/skill-file-map-auto-regen.yml` | **Auto-regen** av `SKILL_FILE_MAP.md` ved push til main hvis skills/scope-endring → auto-PR | Hver merge til main som rører `.claude/skills/**` |
| `npm run skills:map` / `npm run skills:for-file -- <file>` | Convenience-wrappers | Lokalt + CI |

### Bredde-prinsipper

- **Konservativt:** En skill MÅ kun matche filer der dens invarianter faktisk gjelder. Over-aggressive scopes (`apps/backend/**`) gir false-positives og senker tillit til auto-loading.
- **Tech-stack-skills uten file-scope:** `typescript`, `vite`, `docker`, `bun`, `node`, `express` osv. finnes som tekst-referanser i CLAUDE.md men har INGEN `.claude/skills/<name>/SKILL.md`-fil. Det er bevisst — de er for brede til å koble til konkrete filer.
- **Tom scope (`<!-- scope: -->`)** = "skill loaded eksplisitt eller via PM-judgement, ikke via fil-trigger". Brukes hvis en skill bevisst ikke har file-trigger.

### Skill-katalog-tabell

Se `docs/auto-generated/SKILL_FILE_MAP.md` for current state — auto-generert per push til main.

---

## 3. Konkret enforcement-mekanismer

| Mekanisme | Status | Hva den fanger |
|---|---|---|
| `scripts/generate-context-pack.sh` | ✅ Implementert | Auto-brief per agent-spawn (inkl. skill-mapping seksjon 1) |
| `scripts/find-skills-for-file.mjs` | ✅ Implementert | CLI for å finne relevante skills for en gitt file |
| `scripts/build-skill-file-map.mjs` | ✅ Implementert | Generer SKILL_FILE_MAP.md med scope-coverage |
| `skill-mapping-validate.yml` workflow | ✅ Implementert | Blokkerer PR uten scope-header. Stale map nå warning-only (E4 2026-05-13) |
| `skill-file-map-auto-regen.yml` workflow | ✅ Implementert (E4 2026-05-13) | Auto-regenerer SKILL_FILE_MAP.md ved merge til main + åpner auto-PR |
| `knowledge-protocol-gate.yml` workflow | ✅ Implementert | PR-checkbox påkrevd |
| Pre-commit hook for lese-bekreftelse | 🟡 TODO | Commit blokkert uten markører |
| Danger-rule for delta-rapport | 🟡 TODO | PR blokkert uten delta-fil |
| Auto-detect regression via git blame | 🟡 TODO | Foreslår FRAGILITY-entry når bug fikses |
| Bi-weekly knowledge consolidation script | 🟡 TODO | Identifiserer duplikater + stale entries |
| CODEOWNERS-fragility-mapping | 🟡 TODO | Auto-notify ansvarlig agent |
| Skill self-generation fra mønstre | 🟡 TODO | Auto-foreslår skill-stubs fra recurring patterns |

---

## 4. Tobias' direktiv-bekreftelser

Etter dette dokumentet er kanonisk:

| Krav | Hvordan oppfylles |
|---|---|
| "Alt som gjøres logges" | Pillar 1-5 oppdateres obligatorisk per leveranse + Pillar 6 monitor observerer |
| "Agenten som overvåker lager rapport" | Live-monitor + `/tmp/pilot-monitor.log` + snapshot |
| "Agenter leser brief fra forrige agent" | Context-pack auto-genereres + lese-bekreftelse påkrevd |
| "Flytende — utvikles ved nytt arbeid" | Hver PR oppdaterer pilarene → neste agent ser oppdatert state |
| "Strenge krav på dokumentasjon" | Danger-rule blokkerer uten delta-rapport |
| "Alle agenter må lese før arbeid starter" | Pre-work briefing + commit-message-markører |
| "Vanntett" | Step 1-7 ovenfor — hver step har enforcement |

---

## 5. Skill-evolution (Tier 2 — kommer)

For ekte selv-forbedring må skills evolvere fra agent-arbeid:

1. **Skill-stub-auto-generation:** Bi-weekly script som identifiserer recurring patterns i AGENT_EXECUTION_LOG og foreslår skill-stub-merges
2. **Skill-deprecation-detection:** Hvis skill X ikke har vært referert i 90 dager OG ingen agent har oppdatert det, flag for review
3. **Cross-skill-cross-reference:** Når skill X refereres samtidig som Y i 3+ PR-er, foreslå unified meta-skill
4. **Skill-content-linting:** Skill-files må ha minimum N pattern-eksempler + N anti-pattern-eksempler

Implementeres når Tier 1 (pre-commit + danger + auto-FRAGILITY) er stabilt.

---

## 6. PM-AI sjekkliste — hver gang du spawner agent

- [ ] Identifiser scope (hvilke filer/moduler vil agent røre?)
- [ ] Kjør `bash scripts/generate-context-pack.sh "<patterns>"` → /tmp/agent-context.md
- [ ] Inkluder context-pack i agent-prompt under `## Context Pack (mandatory read)`-seksjon
- [ ] Verifiser live-monitor er aktiv (`ls /tmp/pilot-monitor-snapshot.md` viser fresh fil)
- [ ] Spawn agent med worktree-isolation hvis ≥ 2 parallelle agenter på samme repo
- [ ] Etter agent ferdig: verifiser pilarene oppdatert FØR PR-merge

---

## 7. Tilbakemeldings-loop til Tobias

Etter denne sesjonens arbeid har vi gått fra:

**Før (sesjons-start):**
- 4 kunnskaps-artefakter, alle manuelt vedlikeholdt
- Ingen automatisk briefing
- Ingen enforcement at agent leser
- Live-monitor manglet
- Klient-konsoll-data tapt for server

**Etter (sesjons-slutt):**
- 7 pilarer (4 manuelle + 3 automatiske)
- `generate-context-pack.sh` auto-brief
- knowledge-protocol-gate workflow blokkerer PR
- Live-monitor PID 10059 kjører kontinuerlig
- ConsoleBridge pusher klient-konsoll til server
- FRAGILITY_LOG kobler kode → "ikke-rør-uten-å-verifisere"-regler

**Gjenstår for ekte vanntett (Tier 2 — neste sesjon):**
- Pre-commit hook for lese-bekreftelse
- Danger-rule for delta-rapport
- Auto-FRAGILITY-detection via git blame

---

## Endringslogg

| Dato | Endring | Forfatter |
|---|---|---|
| 2026-05-13 | Initial — etablert 7 pilarer + 7-steg flyt + Tier 1 enforcement | PM-AI (Tobias-direktiv) |
