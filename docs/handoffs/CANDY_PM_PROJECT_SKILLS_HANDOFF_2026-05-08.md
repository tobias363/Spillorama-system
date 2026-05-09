# Handoff til Candy-PM — prosjekt-skills på Spillorama

**Dato:** 2026-05-08
**Fra:** Spillorama-PM (Claude Opus 4.7)
**Til:** Candy-prosjekt-PM
**Formål:** Beskrive de 20 prosjekt-skills som Spillorama nettopp har opprettet, med Candy-relevans-vurdering for hver, slik at Candy-PM kan ta beslutning om hvilke skills Candy-prosjektet bør lage.

---

## 1. Bakgrunn

Spillorama er et live bingo-system for det norske markedet (regulert under pengespillforskriften). Tobias direktiv 2026-05-08:

> *"Veldig opptatt av at vi har best mulig fundament og har arkitektur og dokumentasjon slik at det aldri er noe spørsmål hvis noen skal inn å gjøre endringer."*

Vi etablerte 20 prosjekt-spesifikke "skills" (Claude Code SKILL.md-filer) i `<repo>/.claude/skills/` som auto-aktiveres når en agent berører relevant kode. Hver skill har:

- YAML-frontmatter med pushy description (front-loadede keywords + filnavn)
- Body med kontekst, kjerne-arkitektur, immutable beslutninger, vanlige feil, kanonisk doc-referanse
- Plassering: `<repo>/.claude/skills/<name>/SKILL.md` (project-scope, ikke user-scope)

**Effekten:** Når en agent jobber i Spillorama-repoet og berører eks. `Game1MasterControlService.ts`, aktiveres `spill1-master-flow`-skill automatisk og injiserer fundament-doc-referanser FØR agenten begynner. Det skal aldri lenger være "agent gjorde feil fordi den ikke leste fundamentet".

---

## 2. Spillorama–Candy-forhold

For å vurdere relevans må Candy-PM forstå systemarkitekturen:

| System | Eier | Ansvar |
|---|---|---|
| **Spillorama-system** | Vi | Live bingo, wallet, auth, compliance, hall-admin, lobby, Spill 1-4 web-native, **Candy iframe-host** |
| **Candy** | Candy-team | Selve Candy-spillet (UI, gameplay, assets) |
| **demo-backend** | Candy-team | Candy-backend, demo-login, demo-admin, demo-settings |

**Integrasjon:** Spillorama starter Candy via `POST /api/games/candy/launch` → returnerer URL → klient åpner som iframe. Candy kaller tilbake til `/api/ext-wallet/balance|debit|credit` for shared wallet.

Kanonisk grenseskille: [`docs/architecture/LIVE_BINGO_CANDY_BOUNDARY_2026-04-09.md`](../architecture/LIVE_BINGO_CANDY_BOUNDARY_2026-04-09.md).

**Hva betyr det for skills?**
- Skills som handler om **Spillorama-domene** (live bingo, hall-operasjon, agent-portal) → ikke relevant for Candy
- Skills som handler om **delt infrastruktur** (wallet, audit-trail, anti-fraud) → Candy bør forstå men trenger ikke egen variant (de bruker Spillorama's wallet via bridge)
- Skills som er **universelle utvikler-/ops-mønstre** (testing, migration, observability) → Candy bør lage tilsvarende
- Skills som handler om **integrasjons-grensen** → Candy bør lage motpart (mirror)

---

## 3. Skill-katalog med Candy-relevans

For hver skill: hva den handler om, hva den dekker, og om Candy bør lage tilsvarende.

Legend:
- ❌ **Spillorama-only** — Candy ignorerer
- 🟡 **Inspirasjon** — Candy lager egen variant med eget innhold
- ✅ **Direkte adopt** — Candy kopierer innhold (kanskje justert kontekst)
- 🪞 **Mirror** — Candy lager motpart (samme tema, fra Candy-perspektiv)

### Domene-skills (5 stk)

#### 1. `candy-iframe-integration` 🪞

**Spillorama-side:** Hvordan Spillorama lanserer Candy via launch-endpoint, wallet-bridge `/api/ext-wallet/*`, iframe-overlay og postMessage-protokoll. Aktiveres på keywords: `candy`, `ext-wallet`, `CANDY_BACKEND_URL`, `iframe-overlay`, `OpenUrlInSameTab`, `launchCandyOverlay`.

**Candy-anbefaling:** Lag motpart `spillorama-host-integration` som dokumenterer fra Candy-side:
- Hvordan Candy mottar launch-request
- Wallet-bridge-kontrakt (debit/credit endpoints, autentisering med `CANDY_INTEGRATION_API_KEY`)
- postMessage-events Candy sender til host
- Hvilke env-vars Candy må ha satt
- Test-flyt mellom de to systemene

**Estimert lengde:** 200-250 linjer
**Linjer i Spillorama-versjon:** 242

#### 2. `spill1-master-flow` 🟡

**Spillorama-side:** Master-konsoll, plan-runtime, scheduled-game lifecycle, GoH-master-rom, hall-ready-state. Plan-id vs scheduled-game-id-disambiguation (#1041-bugen).

**Candy-anbefaling:** Inspirasjon — hvis Candy har egne spill med master-rolle eller koordinasjons-flow, lag tilsvarende `<candy-spill>-master-flow`. Ellers irrelevant.

#### 3. `spill2-perpetual-loop` 🟡

**Spillorama-side:** ETT globalt rom for Spill 2 (rocket), perpetual auto-spawn-loop, jackpot-mapping per draw-count, Lucky Number Bonus, åpningstid-guard.

**Candy-anbefaling:** Inspirasjon — hvis Candy har spill med auto-loop-pattern, lag egen variant.

#### 4. `spill3-phase-state-machine` 🟡

**Spillorama-side:** Sequential phase-state-machine for Spill 3 (monsterbingo) — Rad 1 → Rad 2 → ... → Fullt Hus med pauseBetweenRowsMs.

**Candy-anbefaling:** Inspirasjon for spill med state-machine-mekanikk.

#### 5. `spinngo-databingo` ❌

**Spillorama-side:** SpinnGo (Spill 4) regulatorisk klassifisering — databingo med 30%-til-organisasjoner-regel og 2500 kr single-prize-cap.

**Candy-anbefaling:** Ikke relevant. Norsk pengespill-klassifisering for Candy bør håndteres separat hvis applicable.

### Plattform/regulatorisk-skills (5 stk)

#### 6. `wallet-outbox-pattern` ✅

**Spillorama-side:** Casino-grade wallet med REPEATABLE READ + atomic outbox-enqueue + nightly reconciliation + hash-chain audit. BIN-761→764. ALL wallet-touch MÅ gå via WalletAdapter-interface.

**Candy-anbefaling:** **Direkte adopter** — Candy bruker Spillorama's wallet via ext-wallet-bridge, så Candy-utviklere som rører Candy-side wallet-bridge-kode må forstå dette mønsteret. Kopier skill, juster kontekst til Candy-perspektiv (kall Spillorama's wallet, ikke direkte mut).

#### 7. `live-room-robusthet-mandate` 🟡

**Spillorama-side:** Evolution Gaming-grade oppetid (99.95%+) for Spill 1/2/3 live-rom. R1-R12 pilot-gating-tiltak.

**Candy-anbefaling:** Hvis Candy har live multiplayer-spill, lag egen `candy-room-robusthet-mandate` med Candy-spesifikke tiltak. Ellers irrelevant.

#### 8. `pengespillforskriften-compliance` 🟡

**Spillorama-side:** Norsk regulatorisk (§11 distribusjon, §66 obligatorisk pause, §71 daglig rapport, single-prize-cap kun for databingo).

**Candy-anbefaling:** Vurder om Candy faller inn under pengespillforskriften (er det demo-spill eller real-money?). Hvis real-money via Spillorama-wallet → §66 og §71 KAN gjelde, da bør Candy ha egen variant. Hvis demo → ikke relevant.

#### 9. `audit-hash-chain` ❌

**Spillorama-side:** Hash-chain audit-trail for Lotteritilsynet-sporbarhet. Knyttet til Spillorama's wallet-audit-tabell.

**Candy-anbefaling:** Candy bruker Spillorama's wallet, så hash-chain håndteres på Spillorama-side. Candy ignorerer.

#### 10. `anti-fraud-detection` ❌

**Spillorama-side:** Velocity + bot-detection som pre-commit-decoration på Spillorama wallet-mutations (BIN-806).

**Candy-anbefaling:** Anti-fraud kjører på Spillorama-side når Candy debiter/krediter via bridge. Candy ignorerer (men bør vite at fraud-blokk kan returneres fra `/api/ext-wallet/debit`).

### Hall + agent-skills (4 stk)

#### 11. `goh-master-binding` ❌

**Spillorama-side:** Group of Halls + master-hall-rolle for Spill 1 koordinasjon, runtime master-overføring (transferHallAccess 60s handshake).

**Candy-anbefaling:** Spillorama-spesifikk hall-modell. Ikke relevant for Candy.

#### 12. `agent-shift-settlement` ❌

**Spillorama-side:** Agent shift lifecycle, cash-in-out, daily settlement med 14-rad maskin-breakdown (BIN-583).

**Candy-anbefaling:** Hall-operasjon-spesifikk. Ikke relevant.

#### 13. `customer-unique-id` ❌

**Spillorama-side:** Prepaid-kort for walk-in spillere uten konto (BIN-587).

**Candy-anbefaling:** Spillorama-walk-in-flow. Ikke relevant.

#### 14. `agent-portal-master-konsoll` ❌

**Spillorama-side:** UI-mønster for Spill 1 master-konsoll i admin-portal.

**Candy-anbefaling:** Spillorama-UI-spesifikk. Ikke relevant.

### Utvikling-skills (4 stk)

#### 15. `casino-grade-testing` ✅

**Spillorama-side:** Test-mønstre for live-rom — chaos, integration, snapshot, R2/R3 failover. Bruker Vitest 3.1, tsx --test, Playwright. Konvensjoner som `WALLET_PG_TEST_CONNECTION_STRING` env-gate som skipper grasiøst, source-level wiring-regression-test.

**Candy-anbefaling:** **Direkte adopter** — gode test-mønstre for ethvert prosjekt med kompleks state. Kopier skill, juster filsti-eksempler til Candy-strukturen.

#### 16. `database-migration-policy` ✅

**Spillorama-side:** Migration-rekkefølge, idempotent CREATE+ALTER, immutability av merget migrations. ADR-012 (MED-2 lessons).

**Candy-anbefaling:** **Direkte adopter** — universell DB-praksis. Hvis Candy bruker node-pg-migrate eller annet, bare juster konvensjoner.

#### 17. `trace-id-observability` ✅

**Spillorama-side:** Trace-ID propagering full-stack (klient → HTTP → Socket.IO → DB). MED-1.

**Candy-anbefaling:** **Direkte adopter** — universell observability-praksis. Spesielt viktig hvis Candy og Spillorama deler trace-id over iframe-grensen for å spore en spillers reise på tvers.

#### 18. `pm-orchestration-pattern` ✅

**Spillorama-side:** PM-meta-skill — PR-first git-flyt, done-policy (file:line + merge to main + test), auto-pull etter merge, parallelle agenter med worktree-isolation, code-reviewer som gate.

**Candy-anbefaling:** **Direkte adopter** — universell PM-pattern. Anbefales spesielt at Candy-PM bruker samme done-policy så regulator-facing docs ikke har false-Done.

### Operasjonelle skills (2 stk)

#### 19. `dr-runbook-execution` ✅

**Spillorama-side:** Disaster recovery, backup-drills, incident-response, compliance-incident SLA (Lotteritilsynet 24t / Datatilsynet 72t).

**Candy-anbefaling:** **Direkte adopter** med Candy-spesifikke SLA-er. Hvis Candy lagrer brukerdata bør Datatilsynet 72t også gjelde.

#### 20. `health-monitoring-alerting` ✅

**Spillorama-side:** Per-rom health-endpoints + alerting-pipeline (R7 + R8).

**Candy-anbefaling:** **Direkte adopter** — universell observability-praksis. Candy bør ha egen `/api/games/candy/health`-endpoint som Spillorama health-overlay kan inkludere.

---

## 4. Anbefalt skill-katalog for Candy

Basert på relevans-vurderingen over:

### Mirror-skills (Candy-side)

| # | Skill | Hva den må dokumentere |
|---|---|---|
| 1 | `spillorama-host-integration` | Hvordan Candy mottar launch + wallet-bridge fra Spillorama-side |

### Direkte-adopt-skills (kopier fra Spillorama)

| # | Skill | Justering |
|---|---|---|
| 2 | `wallet-outbox-pattern` | Tilpass: Candy bruker Spillorama-wallet via bridge, ikke direkte |
| 3 | `casino-grade-testing` | Juster filsti til Candy-strukturen |
| 4 | `database-migration-policy` | Juster til Candy's migration-tool |
| 5 | `trace-id-observability` | Inkluder cross-system trace over iframe |
| 6 | `pm-orchestration-pattern` | Tilpass om Candy-PM har annen workflow |
| 7 | `dr-runbook-execution` | Candy-spesifikke SLA-er |
| 8 | `health-monitoring-alerting` | Per-Candy-spill health |

### Inspirasjon-skills (lag egne varianter hvis relevant)

| # | Skill | Når Candy trenger den |
|---|---|---|
| 9 | `<candy-spill>-master-flow` | Hvis Candy har spill med master/koordinasjon |
| 10 | `<candy-spill>-loop-pattern` | Hvis Candy har auto-loop-spill |
| 11 | `candy-room-robusthet-mandate` | Hvis Candy har live multiplayer-rom |
| 12 | `candy-regulatory-compliance` | Hvis Candy faller under norsk pengespill-regulatorisk |

**Total estimert for Candy:** 8-12 skills (8 universell + 1-4 Candy-spesifikke)

---

## 5. Hvordan lage skills uten SummonAIkit-CLI

Vi prøvde å installere SummonAIkit men hadde Gatekeeper-friksjon. Anbefalt vei:

**Skills er bare markdown-filer.** Format:

```
<repo>/.claude/skills/<skill-name>/SKILL.md
```

YAML-frontmatter:

```yaml
---
name: skill-navn-kebab-case
description: When the user/agent works with X. Also use when they mention [keywords], [filenames]. [En setning som beskriver hva skillet dekker]. Make sure to use this skill whenever someone touches [files/areas] even if they don't explicitly ask for it.
metadata:
  version: 1.0.0
  project: candy
---
```

Body-struktur (vi bruker):

```markdown
# [Display Name]

[Mandate-setning]

## Kontekst

[Hvorfor området er kritisk + lese-først-doc]

## Kjerne-arkitektur

[Faktiske kode-paths, fil:linje]

## Immutable beslutninger

[Det som ALDRI endres uten beslutning fra prosjekt-eier]

## Vanlige feil og hvordan unngå dem

[Konkret — hva har gått galt før, hva sjekke før commit]

## Kanonisk referanse

[Pek på autoritativ doc]

## Når denne skill-en er aktiv

[Hva agenten bør gjøre annerledes]
```

**Mål-lengde:** 150-300 linjer per skill. Hvis lengre, splitt til `references/`-fil og pek dit.

**Pushy description (kritisk):** Claude under-trigger skills. Front-load:
- Konkrete fil-navn
- Norsk + engelsk keywords
- "Make sure to use this skill whenever..."-fraser

**Project-scope vs user-scope:**
- `<repo>/.claude/skills/` → kun aktiv i Candy-repoet (anbefalt)
- `~/.claude/skills/` → aktiv overalt (vil interferere med Spillorama-skills hvis kollisjon i navn)

**Versjoner:** SKILL.md committed til git, vedlikeholdes sammen med kode + docs. Hver PR som endrer fundament bør sjekke om tilhørende skill må oppdateres.

---

## 6. Eksempel — Spillorama's `wallet-outbox-pattern` (forenklet)

For konkret referanse, se `apps/skills/wallet-outbox-pattern/SKILL.md` i Spillorama-repoet (333 linjer).

Description-eksempel (front-loaded keywords):

```yaml
description: When the user/agent works with wallet-mutating code, payout, ticket-purchase, idempotency-keys, REPEATABLE READ isolation, hash-chain audit, eller wallet-reconciliation. Also use when they mention WalletAdapter, walletAdapter, PostgresWalletAdapter, app_wallet_outbox, app_event_outbox, BIN-761, BIN-762, BIN-763, BIN-764, ADR-003. Make sure to use this skill whenever someone touches wallet-touch code, payout-services, ticket-purchase, eller compliance-ledger — even if they don't explicitly ask for it.
```

Description-egenskap:
- 18+ keywords/filer foran
- Norsk + engelsk
- BIN-numre + ADR-er
- "even if they don't explicitly ask for it"-frase

---

## 7. Anbefalt arbeidsflyt for Candy-PM

### Steg 1 — Inventar nåværende Candy-arkitektur

Start med å liste:
- Hvilke spill/spilltyper har Candy?
- Hvilke service-filer er kritiske (engine, room-manager, etc)?
- Hvilke regulatoriske krav gjelder?
- Hvilke ops-mønstre brukes (DR, monitoring, etc)?

### Steg 2 — Identifiser fundament-doc-er

For hver skill du planlegger, må du peke på en kanonisk fundament-doc. Hvis doc-en ikke finnes, lag den FØRST.

### Steg 3 — Velg skill-rekkefølge

Anbefalt prioritet:

1. `spillorama-host-integration` (Mirror — kritisk for grenseflaten)
2. `wallet-outbox-pattern` (Candy-versjon)
3. Per-spill flow-skills (hvis Candy har komplekse spill)
4. Universal-skills (testing, migration, observability)
5. Ops-skills (DR, health-monitoring)

### Steg 4 — Vedlikeholdspolicy

Etabler i Candy-CLAUDE.md (eller tilsvarende):
- Hver PR som endrer fundament-doc skal sjekke om tilhørende skill må oppdateres
- Hver PR som endrer kjerne-tjeneste skal verifisere at relevante skills triggers korrekt

---

## 8. Spillorama's CLAUDE.md som mønster

Vi har en 🚨-blokk øverst i CLAUDE.md som forplikter agenter til å lese fundament-doc-er. Inspirasjonseksempel:

```markdown
### 🚨 Spill 1, 2, 3 fundament (LESE-FØRST-I-SESJON)

Hvis du rører ETT av live-spillene — Spill 1, 2 eller 3 — les den
tilsvarende implementasjons-status-doc-en FØR du gjør noe:

| Spill | Doc | Når lese |
|---|---|---|
| Spill 1 | @docs/architecture/SPILL1_IMPLEMENTATION_STATUS_2026-05-08.md | ... |
...

Spillene har FUNDAMENTALT forskjellige arkitekturer. Antakelser fra
ett spill overføres IKKE til de andre.
```

Candy bør ha tilsvarende blokk i sin CLAUDE.md som peker på Candy-spesifikke fundament-docs + de delte skills.

---

## 9. Kontakt-punkt

Hvis Candy-PM trenger:
- Å se faktisk skill-innhold → `<spillorama-repo>/.claude/skills/<name>/SKILL.md`
- Å forstå Spillorama-side av integrasjons-grensen → ovennevnte `candy-iframe-integration`-skill + `LIVE_BINGO_CANDY_BOUNDARY_2026-04-09.md`
- Konvensjoner for samarbeid → kontakt Tobias

---

## 10. Endringslogg

| Dato | Hendelse |
|---|---|
| 2026-05-08 | Initial. 20 prosjekt-skills opprettet i Spillorama. Handoff-dokument utarbeidet for Candy-PM. |

---

## Vedlegg A — Komplett liste med descriptions

For raskere oversikt, alle 20 skills med deres beskrivelser:

1. **candy-iframe-integration** — Spillorama-host-side av Candy iframe-integrasjon, wallet-bridge, launch-endpoint
2. **spill1-master-flow** — Plan-runtime + master-actions + scheduled-game-id-disambiguation for Spill 1 (live, per-hall-lobby + GoH-master)
3. **spill2-perpetual-loop** — ETT globalt rom + auto-tick + jackpot-mapping for Spill 2 (rocket, 21-ball 3×3)
4. **spill3-phase-state-machine** — Sequential phase-state-machine for Spill 3 (monsterbingo, 75-ball 5×5)
5. **spinngo-databingo** — Databingo-klassifisering for Spill 4 / SpinnGo (30% til org, 2500 kr cap)
6. **wallet-outbox-pattern** — Casino-grade wallet med outbox + REPEATABLE READ + hash-chain (BIN-761→764)
7. **live-room-robusthet-mandate** — Evolution Gaming-grade oppetid 99.95%+ for live-rom (R1-R12)
8. **pengespillforskriften-compliance** — §11/§66/§71 norsk pengespill-regulatorisk
9. **audit-hash-chain** — Hash-chain audit-trail for Lotteritilsynet-sporbarhet
10. **anti-fraud-detection** — Velocity + bot-detection pre-commit-decoration på wallet-mutations
11. **goh-master-binding** — Group of Halls + master-hall-rolle for Spill 1
12. **agent-shift-settlement** — Agent shift-lifecycle + daily settlement (BIN-583)
13. **customer-unique-id** — Prepaid-kort for walk-in spillere (BIN-587)
14. **agent-portal-master-konsoll** — UI-mønster for Spill 1 master-konsoll
15. **casino-grade-testing** — Chaos + integration + snapshot test-mønstre for live-rom
16. **database-migration-policy** — Migration-rekkefølge + idempotent CREATE+ALTER
17. **trace-id-observability** — Trace-ID propagering full-stack (klient → HTTP → Socket.IO → DB)
18. **pm-orchestration-pattern** — PM-meta-pattern (PR-first, done-policy, auto-pull)
19. **dr-runbook-execution** — Disaster recovery + backup-drills + incident-response
20. **health-monitoring-alerting** — Per-rom health-endpoints + alerting (R7 + R8)

Total content: 3915 linjer SKILL.md-innhold over 20 skills.
