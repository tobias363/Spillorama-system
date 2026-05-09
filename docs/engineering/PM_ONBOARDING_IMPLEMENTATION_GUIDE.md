# PM-onboarding implementasjons-guide for andre prosjekter

**Status:** Kanonisk blueprint. Bruk denne for å replikere PM-onboarding-rutinen i andre prosjekter (Candy, fremtidige spinoffs).
**Sist oppdatert:** 2026-05-09
**Eier:** Tobias Haugen (teknisk lead)
**Opprinnelses-prosjekt:** Spillorama-system (live bingo-plattform)

> **Til PM på Candy-prosjektet eller fremtidige spinoffs:** Denne guiden lar
> deg sette opp samme PM-onboarding-rutine i ditt prosjekt på under 2 timer.
> Mønsteret er testet og validert i Spillorama 2026-05-09 — produserte 100%
> kunnskaps-paritet for ny PM på 60-90 min onboarding-tid.

---

## Innhold

1. [Hvorfor denne rutinen finnes](#1-hvorfor-denne-rutinen-finnes)
2. [Hva som ble bygget i Spillorama (referanse)](#2-hva-som-ble-bygget-i-spillorama-referanse)
3. [Implementasjons-sekvens for nytt prosjekt](#3-implementasjons-sekvens-for-nytt-prosjekt)
4. [Filer du skal lage (template-struktur)](#4-filer-du-skal-lage-template-struktur)
5. [Tilpasninger per prosjekt](#5-tilpasninger-per-prosjekt)
6. [6-agent research-mønster](#6-6-agent-research-mønster)
7. [Verifisering og levering](#7-verifisering-og-levering)
8. [Vedlikeholds-disiplin](#8-vedlikeholds-disiplin)
9. [Vedlegg: filtemplater](#9-vedlegg-filtemplater)

---

## 1. Hvorfor denne rutinen finnes

### Problemet
AI-PM-er har ingen kontekst mellom sesjoner. Hver ny PM må:
- Re-bygge forståelse av prosjektet (30-60 min tapt per overgang)
- Stille spørsmål forrige PM allerede svarte på
- Risikere å bryte etablerte kontrakter (ikke kjent fundament)
- Tape tid på å oppdage kjente fallgruver på nytt

Tobias-direktiv 2026-05-09:
> "Det er ekstremt viktig at fundamentet her er godt dokumentert slik at fremtidige PM/agenter har full forståelse og ikke fraviker fra planen. Viktig at vi får det riktig nå og fortsetter med god dokumentasjon."

### Løsningen
**Tre-lags onboarding-system:**

1. **Live current-state-script** (`scripts/pm-onboarding.sh`) — genererer ferskt snapshot av repo, pilot-gating, dev-stack, åpne PR-er på 3 sekunder
2. **Statisk playbook** (`docs/engineering/PM_ONBOARDING_PLAYBOOK.md`) — alt som ikke endres ofte: direktiver, prosesser, mønstre, anti-mønstre
3. **Quickref + agent-prompts** — 1-side cheatsheet + mal-prompts for research-agenter ved første onboarding

**Flytende-doc-prinsipp:** Hver PM oppdaterer playbook ved sesjons-slutt med ny kunnskap. Slik bygges kunnskapsbase opp permanent uten kontekst-tap.

### Resultat (Spillorama 2026-05-09)
- Ny PM bruker 60-90 min på onboarding (vs 3-4 timer før)
- 100% kunnskaps-paritet med forrige PM
- Ingen "false Done"-bugs, ingen brutte fundament-kontrakter
- Tobias slipper å besvare samme spørsmål om og om igjen

---

## 2. Hva som ble bygget i Spillorama (referanse)

### Filer levert (5 stk + 2 oppdaterte pekere)

| Fil | Linjer | Formål |
|---|---:|---|
| [`docs/engineering/PM_ONBOARDING_PLAYBOOK.md`](./PM_ONBOARDING_PLAYBOOK.md) | ~750 | Komplett trinn-for-trinn-rutine + alle direktiver/anti-mønstre/sjekkpunkter |
| [`docs/engineering/PM_ONBOARDING_QUICKREF.md`](./PM_ONBOARDING_QUICKREF.md) | ~140 | 1-side cheatsheet for under sesjon |
| [`docs/engineering/PM_ONBOARDING_AGENT_PROMPTS.md`](./PM_ONBOARDING_AGENT_PROMPTS.md) | ~250 | Mal-prompts for 6 research-agenter |
| [`docs/engineering/PM_ONBOARDING_IMPLEMENTATION_GUIDE.md`](./PM_ONBOARDING_IMPLEMENTATION_GUIDE.md) | (denne filen) | Blueprint for andre prosjekter |
| [`scripts/pm-onboarding.sh`](../../scripts/pm-onboarding.sh) | ~330 | Kjørbart script for live current-state-rapport |
| `CLAUDE.md` (oppdatert) | +18 linjer | Ny seksjon "PM onboarding (NY PM)" med pekere |
| `MASTER_README.md` (oppdatert) | +6 linjer | Ny pekere-blokk for PM-overgang |

### Prosess (i kronologi)

1. **Tobias-direktiv:** "Lag en komplett rutine ny PM må følge så vi alltid har 100% kunnskaps-paritet"
2. **Spawn 6 parallelle research-agenter** (`Explore`-type) for å finkjemme docs-katalogen
3. **Konsoliderte rapporter** fra alle 6 agenter til strukturert kunnskap
4. **Skrev hoved-playbook** (~750 linjer) med 11 hoved-seksjoner
5. **Skrev quickref + agent-prompts**
6. **Lagde live-state-script** som extension av eksisterende `agent-onboarding.sh`
7. **Oppdaterte hovedpekere** (CLAUDE.md, MASTER_README)
8. **Spawn code-reviewer + file-verifier** parallelt for sluttgranskning
9. **Fikset kosmetiske gaps** (1 label-feil)
10. **Lever til Tobias**

**Total tid:** ~1.5 time fra start til ferdig.

### Hva som er Spillorama-spesifikt vs generisk

**Generisk (kan kopieres til ethvert prosjekt):**
- Tre-lags-strukturen (script + playbook + quickref + agent-prompts)
- 11-seksjons-playbook-skjelett
- 6-agent research-mønster
- Flytende-doc-prinsipp (PM oppdaterer ved sesjons-slutt)
- Sjekkpunkts-mal (~30 yes/no-spørsmål)
- Anti-mønstre-kategorier (git, prosess, domene-spesifikt, kommunikasjon)
- Code-reviewer + file-verifier-validering

**Spillorama-spesifikt (må tilpasses):**
- Pengespillforskriften §§
- Pilot-haller (UUIDs)
- R1-R12 mandat (Live-rom-robusthet)
- Spill 1/2/3-mekanikk
- Audit-hash-chain (BIN-764)
- Wallet-outbox (BIN-761)
- Master-rolle-modellen
- Demo-credentials og test-URL-er
- Render-deploy-prosess

---

## 3. Implementasjons-sekvens for nytt prosjekt

**Total estimert tid:** 1.5-2 timer for første implementasjon.

### Trinn 0 — Forutsetninger (5 min)

Verifiser at prosjektet har:
- [ ] `docs/`-katalog (skal være standard struktur)
- [ ] `BACKLOG.md` eller tilsvarende strategisk roadmap
- [ ] `CLAUDE.md` (hvis Claude Code brukes)
- [ ] Eksisterende PM-handoff-historikk (selv om bare 1-2 doc-er)
- [ ] Git-repo med branch-protection
- [ ] CI/CD-pipeline (GitHub Actions eller tilsvarende)
- [ ] Prosjekt-eier-direktiver (kanoniske kontrakter, immutable regler)

Hvis noe mangler: lag det FØR du implementerer playbook (det vil mangle innhold).

### Trinn 1 — Spawn 6 parallelle research-agenter (10-15 min ventetid)

Bruk mal-prompts i §6 nedenfor. Tilpass file-paths til ditt prosjekt.

Mens agentene jobber: les ditt prosjekts `MASTER_README.md` (eller tilsvarende) selv.

### Trinn 2 — Skriv playbook-skjelett (15 min)

Kopier seksjons-strukturen fra Spillorama (se §4 nedenfor). Fyll inn med plassholdere først, agent-rapporter senere.

### Trinn 3 — Konsolider agent-rapporter (20-30 min)

Når alle 6 agenter har returnert, fyll inn relevante seksjoner basert på rapportene. Rangér etter prosjekt-prioritet:
- Compliance / regulatorisk (hvis relevant)
- Pilot-status / live-state
- Tekniske mønstre
- Anti-mønstre
- Kommunikasjons-mønstre

### Trinn 4 — Skriv quickref + agent-prompts (15 min)

- Quickref: hent ut de 10-15 viktigste reglene/kommandoene
- Agent-prompts: kopier mal-prompts og tilpass file-paths

### Trinn 5 — Skriv pm-onboarding-script (20 min)

Tilpass [`scripts/pm-onboarding.sh`](../../scripts/pm-onboarding.sh) fra Spillorama. Endre:
- Repo-rot
- Pilot-gating-tabell (eller fjern hvis ikke relevant)
- Health-endpoints
- Login-credentials
- Dev-stack-helse-sjekker

### Trinn 6 — Oppdater pekere (5 min)

Legg seksjon i:
- `CLAUDE.md` (rot) med "PM onboarding (NY PM)"
- `MASTER_README.md` med 3-linjes pekere-blokk

### Trinn 7 — Verifiser (10 min)

Spawn 2 verifiserings-agenter parallelt:
- **Code-reviewer:** completeness, konsistens, kjørbarhet, gaps
- **File-verifier:** alle markdown-linker peker på filer som eksisterer

Fikse kritiske gaps før levering.

### Trinn 8 — Lever (5 min)

Commit alt som én PR (eller del i 2 hvis prosjektet har konvensjon for det). Bekreft til prosjekt-eier at rutinen er klar.

---

## 4. Filer du skal lage (template-struktur)

### 4.1 `docs/engineering/PM_ONBOARDING_PLAYBOOK.md` (hovedfil)

**11 hoved-seksjoner (kanonisk struktur):**

```markdown
# PM-onboarding-playbook — <prosjekt-navn>

**Status:** Autoritativ
**Sist oppdatert:** YYYY-MM-DD
**Eier:** <prosjekt-eier>
**Vedlikehold:** Flytende — PM må oppdatere ved sesjons-slutt

## 1. 30-sekund-pitch og kontekst
- Hva er prosjektet (1 setning)
- Tech-stack-tabell
- Skala / pilot-mål
- Repo + prod-URL + Linear

## 2. <Prosjekt-eier>'s fundamentale direktiver (immutable)
- Liste av regler som ALDRI endres uten godkjennelse
- Hver regel med kort bakgrunn

## 3. Trinn-for-trinn onboarding-rutine
- 5-7 trinn med tidsestimater
- Hvert trinn med konkret kommando eller doc-pekere

## 4. Lese-først-prioritert med tidsestimater
- 5 tiers (kritisk → referanse)
- Hver doc med ETA og når-skal-leses

## 5. Kommunikasjons-mønstre med <prosjekt-eier>
- Direktiver-stil
- Frustrasjons-signaler → riktig respons
- Tillits-signaler
- Kvalitets-fokus
- Hva PM eier vs hva eier eier

## 6. Compliance / regulatorisk (hvis relevant)
- Lover/forskrifter
- Audit-historikk
- Compliance-fallgruver

## 7. Pilot-status og runbooks
- R-tiltak-tabell (hvis relevant)
- Pilot-haller / kunder
- Runbook-kart per fase

## 8. Tekniske prosedyrer
- Branch-naming
- Commit-format
- PR-flyt
- CI-gates
- Deploy / rollback / restart

## 9. Anti-mønstre og fallgruver
- Git-anti-mønstre
- Compliance-anti-mønstre (hvis relevant)
- Domene-spesifikke anti-mønstre
- Kommunikasjons-anti-mønstre

## 10. Sjekkpunkter for fullført onboarding
- ~30 yes/no-spørsmål kategorisert
- Sesjons-slutt-sjekkliste

## 11. Vedlikehold av playbook (FLYTENDE DOKUMENT)
- 🚨 KRITISK PRINSIPP: PM må oppdatere ved sesjons-slutt
- MÅ-oppdater-sjekkliste
- KAN-oppdater
- Når IKKE oppdater
- Endringslogg per sesjon

## Vedlegg A — Login-credentials
## Vedlegg B — URL-er for testing
## Vedlegg C — Skill-katalog (hvis prosjektet har skills)
```

### 4.2 `docs/engineering/PM_ONBOARDING_QUICKREF.md` (1-side cheatsheet)

```markdown
# PM Quick Reference — 1-side cheatsheet

## Generer current-state-rapport
./scripts/pm-onboarding.sh > /tmp/pm-onboarding.md

## Standard restart-kommando (gi til <eier> etter merge)
[bash-kommando med cd og restart]

## PR-flyt
[git checkout -b … kommando-blokk]

## Login (alle bruker '<passord>')
[tabell med rolle/email/hall]

## <Domene-spesifikk> kanonisk regel-tabell
[de viktigste reglene]

## Compliance ALDRI-regler (hvis relevant)
1. ❌ …
2. ❌ …

## Pilot-status (R-tiltak)
✅ Grønt: R…
⚠️ Utvidelses-blokkere: R…

## <Prosjekt-eier>-mønstre
[tabell med signaler]

## Linear / Render / dashboards
[links]

## Hva PM eier vs <eier> eier
[tabell]

---

**Full playbook:** [PM_ONBOARDING_PLAYBOOK.md](./PM_ONBOARDING_PLAYBOOK.md)
**Live current-state:** ./scripts/pm-onboarding.sh > /tmp/pm-onboarding.md
```

### 4.3 `docs/engineering/PM_ONBOARDING_AGENT_PROMPTS.md` (research-mal)

Se §6 nedenfor for ferdige mal-prompts.

### 4.4 `scripts/pm-onboarding.sh` (live current-state)

Kopier fra Spillorama, tilpass:
- Repo-rot
- Pilot-gating-data (hvis relevant)
- Health-endpoints
- Login-credentials
- Restart-kommandoer

### 4.5 Pekere i CLAUDE.md + MASTER_README.md

```markdown
### PM onboarding (NY PM)

**Hvis du tar over som PM**, følg den fulle onboarding-rutinen i
@docs/engineering/PM_ONBOARDING_PLAYBOOK.md (60-90 min). Generer live
current-state-rapport med:

./scripts/pm-onboarding.sh > /tmp/pm-onboarding.md

For 1-side cheatsheet, se @docs/engineering/PM_ONBOARDING_QUICKREF.md.
For mal-prompts ved første onboarding, se
@docs/engineering/PM_ONBOARDING_AGENT_PROMPTS.md.
```

---

## 5. Tilpasninger per prosjekt

### 5.1 For Candy-prosjektet spesifikt

**Candy = tredjeparts-spill integrert via iframe i Spillorama.** Det er et separat repo med egen tech-stack og egen kontekst.

**Spesifikke tilpasninger Candy-PM bør gjøre:**

#### §1 (Pitch)
```markdown
**Candy** er et frittstående spill integrert i Spillorama via iframe.
Wallet-bro deler saldo med Spillorama, men spilllogikk + RNG eier vi.

| Område | Status |
|---|---|
| Integrasjon | iframe-overlay i Spillorama-shell |
| Wallet-bro | /api/ext-wallet/* (server-til-server) |
| Tech-stack | <Candy-spesifikk stack> |
| Repo | tobias363/candy-web |
```

#### §2 (Direktiver — viktige forskjeller fra Spillorama)
- **Candy eier IKKE wallet-state** — Spillorama er authoritative; Candy bruker wallet-bro
- **Candy eier RNG og spillregler** — disse er Candy-leverandør-ansvar, ikke Spillorama
- **iframe-postMessage-protokoll med Spillorama-host** — endringer påvirker BÅDE prosjekter
- **Candy bruker Spillorama auth-token** — endring av token-format krever koordinering

Eier-direktiver fra Spillorama-side (ikke Candy-side):
- Spillorama eier compliance og §11-distribusjon — ikke Candy
- Spillorama eier player-balance og loss-limits — ikke Candy
- Candy må respektere Spillorama-side `restrictions.isBlocked`

#### §6 (Compliance)
**Spillorama gjør:** §11 + §66 + §71 + audit-trail på all wallet-touch fra Candy
**Candy gjør:** logger spillresultater for sin egen audit, ikke for Spillorama
**Grense:** Wallet-bridge er det eneste touchpoint. Hver Candy-debit skrives til Spillorama compliance-ledger med `gameType: "EXTERNAL_CANDY"` (eller tilsvarende).

#### §7 (Pilot)
- Pilot for Candy avhenger av Spillorama pilot-go-live
- Wallet-bridge må være verifisert opp mot Spillorama før Candy kan testes med ekte penger

#### §9 (Anti-mønstre Candy-spesifikt)
- ❌ Candy lagrer wallet-state lokalt → Feil. Server-til-server kall til Spillorama
- ❌ Candy ignorerer `restrictions.isBlocked` fra Spillorama → Feil. Fail-closed, blokker spill
- ❌ Candy endrer iframe-postMessage-format uten å varsle Spillorama → Feil. Begge må deploys koordinert
- ❌ Candy emitterer `wallet:state` direkte til klient → Feil. Spillorama eier wallet-events

#### §11 (Vedlikehold)
Når Candy-PM oppdaterer playbook, husk:
- Hvis endring påvirker iframe-protokoll → varsle Spillorama-PM samtidig
- Hvis endring påvirker wallet-bridge-kontrakt → koordinert deploy med Spillorama
- Spillorama-side kanoniske docs (`CANDY_SPILLORAMA_API_CONTRACT.md`) er **eier av integrasjons-spec**

### 5.2 For andre fremtidige prosjekter

**Spør:** "Hva er kanonisk doc for hva i dette prosjektet?"
- For Spillorama: `SPILL_REGLER_OG_PAYOUT.md` er payout-bibel
- For Candy: `CANDY_INTEGRATION.md` er integrasjons-bibel
- For X: ?

**Spør:** "Hvilke regler er IMMUTABLE?"
- For Spillorama: pengespillforskriften, master-rolle, Spill-katalog
- For Candy: iframe-protokoll, wallet-bro-kontrakt, Spillorama-grense
- For X: ?

**Spør:** "Hva er pilot/launch-kriterier?"
- For Spillorama: R1-R12 + 4-hall-pilot
- For Candy: wallet-bridge verified + iframe-host stable
- For X: ?

---

## 6. 6-agent research-mønster

Disse 6 agentene gir deg full kunnskaps-paritet på ~10-15 min parallell ventetid. Tilpass file-paths til ditt prosjekt.

### Generisk mal (alle 6 spawns)

```typescript
// I AI-PM-sesjon, send som parallel tool-use:
[
  Agent({ subagent_type: "Explore", description: "...", prompt: promptA, run_in_background: true }),
  Agent({ subagent_type: "Explore", description: "...", prompt: promptB, run_in_background: true }),
  Agent({ subagent_type: "Explore", description: "...", prompt: promptC, run_in_background: true }),
  Agent({ subagent_type: "Explore", description: "...", prompt: promptD, run_in_background: true }),
  Agent({ subagent_type: "Explore", description: "...", prompt: promptE, run_in_background: true }),
  Agent({ subagent_type: "Explore", description: "...", prompt: promptF, run_in_background: true }),
]
```

### Agent A — Skills/domain-knowledge deep-dive

**Mal:**
```
Du er research-agent for VANNTETT PM-onboarding-playbook for <prosjekt>.

Oppgave: Les .claude/skills/ (eller tilsvarende domain-knowledge-katalog).
For hver kritisk skill, produser:
- Når aktiveres
- Kjerne-invariants (max 5 — det som ALDRI skal endres)
- Vanlige fallgruver (max 5)
- Kritiske file:line-pekere
- Cross-skill-koblinger

Hold under 350 linjer. Returner direkte i din response.
```

### Agent B — PM-handoff-historikk kronologi

**Mal:**
```
Oppgave: Les ALLE PM-handoff-doc-er i kronologisk rekkefølge i <prosjekt>.
Produser:
1. Tidslinje per handoff (én linje per dato)
2. Pågående refaktor-bølger
3. Mest betydningsfulle arkitektur-beslutninger
4. Kjente uløste blokkere som har overlevd flere sesjoner
5. Mønstre i prosjekt-eier sin kommunikasjon

Hold under 300 linjer.
```

### Agent C — Pilot-/launch-test-status

**Mal:**
```
Oppgave: Kartlegg current pilot/launch-readiness i <prosjekt>.
Les test-resultater + runbooks i docs/operations/.

Produser:
1. Pilot/launch-tiltak-tabell (status + blokker ja/nei)
2. Pilot/launch-go-live-kriterier
3. Kjente uløste risikoer
4. Test-dekking-status

Hold under 250 linjer.
```

### Agent D — Compliance + Audit (hvis regulert prosjekt)

**Mal:**
```
Oppgave: Finkjem ALL compliance- og audit-relatert dokumentasjon i <prosjekt>.

Produser:
1. Regulatorisk grunnlag (§§ + tilsynsorgan + sanksjoner)
2. Compliance-dokumenter (kategorisert: kritisk/viktig/referanse)
3. Audit-historikk (kjørt + åpne)
4. Compliance-fallgruver
5. Kritiske invariants per regel
6. Pilot/launch-gating

Hold under 400 linjer.
```

For ikke-regulerte prosjekter: erstatt med "Security + privacy" eller drop helt.

### Agent E — Engineering workflow research

**Mal:**
```
Oppgave: Kartlegg engineering-prosess, PR-flyt, ADR-prosess, konvensjoner i <prosjekt>.

Områder:
- docs/engineering/
- docs/adr/ (eller decisions/)
- CLAUDE.md
- .github/workflows/
- .github/pull_request_template.md

Produser:
1. PR-flyt (kanonisk)
2. ADR-prosess
3. Engineering-konvensjoner (file naming, code naming, imports, strict-mode)
4. Tekniske backlog
5. PM-orchestration-mønster
6. CI/CD-pipelines (workflows, blocking gates)
7. Anti-mønstre fra historikken
8. Repo-struktur

Hold under 400 linjer.
```

### Agent F — Architecture deep-dive

**Mal:**
```
Oppgave: Dykk ned i de teknisk dypeste arkitektur-doc-ene i <prosjekt>.

Områder:
- docs/architecture/
- docs/auto-generated/ (hvis eksisterer)
- Module-kataloger
- Event-protokoll / wire-contract / API-spec

Produser:
1. System-modul-kart
2. Socket.IO / event-katalog (hvis relevant)
3. Wire-contract (request/response, error-codes)
4. Per-feature-mekanikk
5. Skala-arkitektur
6. Anti-fraud / resilience / lobby (hvis relevant)
7. Database-snapshot
8. API-endpoint-omfang
9. Eksterne grenser (3rd party integrasjoner)
10. Per-modul-deep-dive

Hold under 500 linjer.
```

---

## 7. Verifisering og levering

### 7.1 To verifiserings-agenter (parallelt etter playbook er ferdig)

**Code-reviewer-agent:**
```
Oppgave: Granske PM-onboarding-playbook for completeness, konsistens, kjørbarhet, gaps.

Sjekk:
1. Completeness — er noe kritisk MISSING?
2. Konsistens — motsier playbook noen kanoniske doc-er?
3. Kjørbarhet — fungerer kommandoene?
4. <Eier>-stil-match — for verbose noen steder?
5. Gaps — hva er ikke dekket?
6. File-pekere — eksisterer alle linker?

Output: severity-summary + findings ordnet etter severity.
```

**File-verifier-agent:**
```
Oppgave: Sjekk at ALLE filer som playbook refererer til faktisk eksisterer.

1. Les hele playbook
2. Ekstraher ALLE markdown-link-mål (relative paths)
3. For hver, sjekk om filen eksisterer på disk
4. Returner liste:
   - ✅ Eksisterer
   - 🚫 Mangler (kritisk!)

Sjekk også inline file-paths i kodeblokker.
```

### 7.2 Iterasjon

Hvis verifier finner gaps:
- **Kritiske:** Fix umiddelbart
- **Mindre (kosmetiske):** Fix i samme sesjon hvis tid, ellers post-pilot
- **Mangelfulle pekere:** Fix før levering (ALLE må peke rett)

### 7.3 Levering

```bash
# Stage filene
git checkout -b docs/pm-onboarding-playbook-YYYY-MM-DD
git add docs/engineering/PM_ONBOARDING_PLAYBOOK.md
git add docs/engineering/PM_ONBOARDING_QUICKREF.md
git add docs/engineering/PM_ONBOARDING_AGENT_PROMPTS.md
git add scripts/pm-onboarding.sh
git add CLAUDE.md
git add MASTER_README.md  # eller README.md

# Commit
git commit -m "$(cat <<'EOF'
docs(engineering): add PM_ONBOARDING_PLAYBOOK + agents-prompts + script

Komplett onboarding-rutine for ny PM. Replikerer mønster validert i
Spillorama 2026-05-09 — produserte 100% kunnskaps-paritet på 60-90 min
onboarding-tid.

Filer:
- PM_ONBOARDING_PLAYBOOK.md (full rutine, 11 seksjoner)
- PM_ONBOARDING_QUICKREF.md (1-side cheatsheet)
- PM_ONBOARDING_AGENT_PROMPTS.md (mal-prompts for research)
- scripts/pm-onboarding.sh (live current-state-rapport)
- CLAUDE.md, MASTER_README.md (oppdaterte pekere)

Flytende-doc-prinsipp: PM oppdaterer playbook ved hver sesjons-slutt.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"

# Push + PR + auto-merge
git push -u origin docs/pm-onboarding-playbook-YYYY-MM-DD
gh pr create --title "docs(engineering): PM_ONBOARDING_PLAYBOOK + tools" --body "..."
gh pr merge <nr> --squash --auto --delete-branch
```

---

## 8. Vedlikeholds-disiplin

### Det viktigste prinsippet

**Playbook er flytende.** Hver PM oppdaterer ved sesjons-slutt slik at neste PM har samme kunnskap. Hvis vi ikke vedlikeholder, mister vi det viktigste verktøyet vi har.

### Sesjons-slutt-sjekkliste (legg dette i §10 i din playbook)

- [ ] Skrev jeg PM_HANDOFF_<dato>.md?
- [ ] Oppdaterte jeg PM_ONBOARDING_PLAYBOOK med nye direktiver / anti-mønstre / status-endringer?
- [ ] Oppdaterte jeg BACKLOG.md hvis pilot-blokker-status endret seg?
- [ ] Oppdaterte jeg Linear-issues med Done-policy?
- [ ] Skrev jeg ADR hvis arkitektonisk beslutning ble fattet?
- [ ] Pulled jeg main i hovedrepoet etter siste merge?
- [ ] Ga jeg <eier> hot-reload-restart-kommando?

### Hva som UTLØSER playbook-oppdatering

| Hendelse | Seksjon å oppdatere |
|---|---|
| <Eier> gir ny immutable direktiv | §2 |
| Du lærer nytt kommunikasjons-mønster | §5 |
| Audit-status endres | §6 |
| Pilot/launch-status endres | §7 |
| Ny pilot-deltaker | §7.3 |
| Du oppdager ny fallgruve | §9 |
| Tech-stack endres | §1 |
| Ny ADR | §11 cross-ref |

---

## 9. Vedlegg: filtemplater

For å gjøre Candy-PM-implementasjonen rask, her er starter-templater du kan kopiere:

### 9.1 Candy `PM_ONBOARDING_PLAYBOOK.md` (skjelett)

```markdown
# PM-onboarding-playbook — Candy

**Status:** Autoritativ
**Sist oppdatert:** YYYY-MM-DD
**Eier:** Tobias Haugen (teknisk lead)
**Vedlikehold:** Flytende — PM må oppdatere ved sesjons-slutt

## 1. 30-sekund-pitch og kontekst

**Candy** er et frittstående spill integrert i Spillorama via iframe.
Tech-stack: <fyll inn>. Repo: tobias363/candy-web.

Wallet-bro: server-til-server kall til Spillorama-backend
(`/api/ext-wallet/*`). Spillorama eier wallet-state; Candy eier RNG.

## 2. Tobias' fundamentale direktiver (immutable)

### 2.1 Candy eier IKKE wallet-state
[forklaring]

### 2.2 iframe-postMessage-protokoll deles med Spillorama-host
[forklaring]

### 2.3 [andre Candy-spesifikke direktiver fra Tobias]
[forklaring]

## 3-11. [Følg samme struktur som Spillorama playbook]
```

### 9.2 Candy `pm-onboarding.sh` (skjelett)

Kopier fra Spillorama, endre:
- `REPO_ROOT` til Candy-rot
- Pilot-gating-tabell (Candy-spesifikk hvis relevant)
- Health-endpoints til Candy-backend
- Login-credentials til Candy demo-brukere

### 9.3 Candy CLAUDE.md-tillegg

```markdown
### PM onboarding (NY PM)

**Hvis du tar over som PM**, følg den fulle onboarding-rutinen i
@docs/engineering/PM_ONBOARDING_PLAYBOOK.md (60-90 min). Generer live
current-state-rapport med:

./scripts/pm-onboarding.sh > /tmp/pm-onboarding.md

Cross-prosjekt-kobling: Candy integreres med Spillorama-system (separat
repo). Hvis endring påvirker iframe-protokoll eller wallet-bridge-kontrakt,
koordiner med Spillorama-PM. Se Spillorama-side
`docs/architecture/CANDY_SPILLORAMA_API_CONTRACT.md` for kanonisk
integrasjons-spec.
```

---

## 10. Endringslogg

| Dato | Endring | Forfatter |
|---|---|---|
| 2026-05-09 | Initial — implementasjons-guide for å replikere PM-onboarding-rutinen i andre prosjekter (Candy + fremtidige) | PM-AI (Claude Opus 4.7) |

---

## Til Candy-PM (eller annen PM som leser dette)

Hvis du sitter med dette dokumentet og skal implementere PM-onboarding for ditt prosjekt:

1. **Les §1-§3 først** — du forstår mønsteret og prosessen
2. **Følg §3 (implementasjons-sekvens)** trinn for trinn
3. **Tilpass §4 (template-struktur)** til ditt prosjekt
4. **Bruk §6 (research-mønster)** for å spawn parallelle agenter
5. **Verifiser med §7** før levering
6. **Husk §8 (vedlikeholds-disiplin)** — uten det forvitrer kunnskap

**Total tid:** 1.5-2 timer for første implementasjon. Etter det er det 5-15 min per sesjon for vedlikehold.

**Spør Tobias** hvis prosjekt-spesifikke direktiver er uklare. Bedre å spørre én gang enn å bryte fundamental kontrakt.

**Lykke til. Mønsteret er testet og fungerer.**
