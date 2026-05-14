# PM Quick Reference — Spillorama

**Status:** Autoritativ hurtigreferanse. 2-3 sider med absolutt-essensiell PM-kunnskap.
**Sist oppdatert:** 2026-05-15
**Eier:** Tobias Haugen (teknisk lead)
**Formål:** Konsolidere det viktigste fra `PM_ONBOARDING_PLAYBOOK.md` (~30 sider) i én side du kan ha åpen mens du jobber.

> **🚨 Denne fila erstatter IKKE playbook-en.** Playbook-en er fortsatt
> kanonisk-doc for full onboarding (60-90 min). Denne fila er for
> daglig-bruk når du allerede er onboardet og trenger rask oppslags-kilde.

---

## ⛔ Kontinuitet-direktiv (Tobias 2026-05-15) — IMMUTABLE

> "Kan du også da legge inn i tekst til ny PM at han da må fortsette i samme spor og arkitektur når han fortsetter med sitt arbeid og dokumenterer fortløpende."
> — Tobias 2026-05-15

**HARD REGEL for ny PM som tar over:**

1. **Fortsett i samme spor.** Hvis forrige PM jobbet med en P0-blokker (eks. Next Game Display-bug, casino-grade Bølge X, eller pilot-utrulling), så fortsetter DU med samme blokker. Ikke pivoter, ikke start nye initiativ, ikke "ta noe annet først". Tobias bekrefter eksplisitt hvis det skal pivoteres.

2. **Fortsett i samme arkitektur.** Hvis forrige PM etablerte et mønster (eks. SESSION_KNOWLEDGE_EXPORT, vanntett-gate-prinsippet, single-source-of-truth-pattern, 6-research-agenter-deep-dive), så VIDEREFØRER DU det. Du bryter ikke etablert arkitektur uten å skrive ADR + få Tobias-godkjennelse i samme sesjon.

3. **Dokumenter fortløpende — ikke ved sesjons-slutt.** Skriv PITFALLS_LOG-entry NÅR du oppdager fallgruven. Oppdater skill NÅR du oppdager mønsteret. Skriv ADR NÅR beslutningen tas. Ikke "samle opp" til Trinn 7-9 av sesjons-slutt-checklist — da glipper detaljer.

4. **Hver fix-agent-prompt MÅ inneholde dokumentasjons-protokoll.** Se §2.19 i PM_ONBOARDING_PLAYBOOK. Mal i `docs/engineering/SKILL_DOC_PROTOCOL_TEMPLATE.md`. Verifiseres ved PR-review.

5. **Når i tvil — les playbook + spør Tobias.** Bedre å pause 5 min for å sjekke en doc enn å implementere noe som bryter etablert pattern.

**Hvorfor dette er kritisk:** Spillorama har 60+ dokumenterte fallgruver (PITFALLS_LOG), 23+ ADR-er, 20+ skills, og 30+ PM-handoffs. Hver gang en PM pivoterer eller bryter pattern uten godkjennelse, mister vi kontinuitet — og neste PM må re-discover det som allerede var løst. Tobias-direktiv 2026-05-10: *"Det er ekstremt viktig at vi setter den rutinen slik at man alltid leser ALL dokumentasjon — slik at man har all kontekst og ikke går i de samme fallgruvene som tidligere."*

---

## 1. Tobias' IMMUTABLE direktiver (12 stk)

| # | Direktiv | Dato | Konsekvens hvis brutt |
|---|---|---|---|
| 2.1 | Quality > speed. Ingen deadline. All død kode fjernes. | 2026-05-05 | Buggy ship = tap av tillit |
| 2.2 | Tobias rør ALDRI git lokalt. PM eier `git pull` + `dev:nuke` etter hver merge. | 2026-05-08, oppd. 2026-05-11 | Stale state = ufunksjonell test |
| 2.3 | PM verifiser CI etter PR-åpning (5-10 min). | 2026-05-09 | INFRA-bug ikke fanget |
| 2.4 | Doc-en vinner over kode. Konflikt → fix koden, ikke doc-en. | 2026-04-XX | Drift mellom intent og state |
| 2.5 | Spill 1/2/3 har FUNDAMENTALT forskjellige arkitekturer. Antakelser overføres IKKE. | 2026-05-08 | Bugs som ødelegger live-rom |
| 2.6 | Spill 4 = SpinnGo = `spillorama` slug = DATABINGO (30% + 2500 kr cap). | 2026-04-25 | §11-rapport feil = Lotteritilsynet-risiko |
| 2.7 | PM-sentralisert git-flyt (ADR-0009). Agent commit+push; PM PR+merge. | 2026-04-21 | Race-conditions ved merge |
| 2.8 | Done-policy (ADR-0010): merget til main + file:line + grønn CI. | 2026-04-17 | Falske Done-funn (4 stk historisk) |
| 2.9 | Live-rom 99.95% uptime. R1-R12 = pilot-gating. | 2026-05-08 | Pilot-blokker |
| 2.10 | 4-hall-pilot først. Utvidelse betinger R4/R6/R9 + 2-4 ukers stabilitet. | 2026-05-08 | Skala-fall |
| 2.11 | Skill-loading lazy per-task. | 2026-04-25 | Context-overflow |
| 2.18 | Live-monitor ALLTID aktiv ved testing. | 2026-05-13 | Tobias er BLIND ellers |
| 2.19 | Skill-doc-protokoll ALLTID i fix-agent-prompts. | 2026-05-14 | "2 skritt frem, 1 tilbake" |
| 2.20 | Sentry + PostHog overvåking ALLTID aktiv ved testing. | 2026-05-14 | Bugs ikke fanget i sanntid |

**Hvis du må huske bare 5:** §2.2 (dev:nuke), §2.4 (doc vinner), §2.5 (Spill 1/2/3 ulike), §2.18 (monitor alltid på), §2.19 (skill-doc-protokoll alltid).

---

## 2. Gates og scripts (vanntett-system)

**5 lag håndhevelse — du kan IKKE skippe noen av disse uten å bryte direktiv:**

| Lag | Hva | Hvor håndheves | Hvordan kjøre |
|---|---|---|---|
| 0. **Onboarding-gate** | Per-fil-bekreftelse av ALLE handoffs siden 2026-04-23 | `bash scripts/pm-checkpoint.sh` | Første handling ved ny PM-sesjon |
| 0.5. **Doc-absorption-gate** | Verifiserer at PM har lest siste KNOWLEDGE_EXPORT + skills + ADR-er | `bash scripts/pm-doc-absorption-gate.sh` | Etter pm-checkpoint, før kode |
| 1. **Pre-commit blokk** | Commit blokkeres lokalt hvis gate ikke gyldig | `.husky/pre-commit` → `node scripts/check-pm-gate.mjs --strict` | Automatisk |
| 2. **PR-merge blokk** | PR kan ikke merges uten verifisert gate-marker | `.github/workflows/pm-gate-enforcement.yml` | Automatisk |
| 3. **Post-merge CI-watcher** | Røde workflows på main → auto-issue tagger PM | `.github/workflows/pm-merge-verification.yml` | Automatisk |
| 4. **Session-end-runner** | Validerer Trinn 1-8 + signerer `.pm-session-end-confirmed.txt` | `bash scripts/pm-session-end.sh` | Siste handling ved sesjons-slutt |

**For ikke-PM-roller** (Tobias, dependabot, agenter under PM-koordinering):
- PR-template har checkbox: `gate-not-applicable: <rolle>` i PR-beskrivelse
- Engang-bypass: `PM_GATE_BYPASS=1` (dokumentert)

---

## 3. Spill 1/2/3 — fundamentale forskjeller

> **🚨 Kanonisk cross-spill-sammenligning: [`SPILL_ARCHITECTURE_OVERVIEW.md`](../architecture/SPILL_ARCHITECTURE_OVERVIEW.md).**
>
> Full tabell med alle aspekter (grid, ball-range, rom-modell, master-rolle, spilleplan, auto-restart, vinning, bonus, compliance, premie-modus, salgskanaler m.fl.) ligger der. IKKE overfør antakelser mellom spillene.

**Korte hovedforskjeller (executive summary):**

- **Spill 1** (`bingo`) — 5×5 m/fri sentercelle, 1-75, per-hall lobby + GoH-master + plan-runtime + scheduled-games. Master starter/pauser bevisst. 13 katalog-varianter.
- **Spill 2** (`rocket`) — 3×3 full plate, 1-21, ETT globalt rom (`ROCKET`), perpetual loop, auto-tick. Ingen master, ingen plan. Auto-start på `minTicketsToStart`. Jackpot-mapping per draw-count.
- **Spill 3** (`monsterbingo`) — 5×5 uten sentercelle, 1-75, ETT globalt rom (`MONSTERBINGO`), perpetual loop, sequential phase-state-machine (Rad 1 → 3s pause → Rad 2 → … → Fullt Hus med auto-pause).
- **Compliance §11:** Alle tre = `MAIN_GAME` = 15% til organisasjoner. INGEN single-prize-cap (kun SpinnGo har 2500 kr cap).

**Bridge-pattern:** `Spill2GlobalRoomService` og `Spill3GlobalRoomService` mapper `Spill[2-3]Config` til `GameVariantConfig`. Spill 3 setter `autoClaimPhaseMode=true` for å aktivere phase-state-machine.

**Kanoniske docs:**
- [SPILL_ARCHITECTURE_OVERVIEW.md](../architecture/SPILL_ARCHITECTURE_OVERVIEW.md) ← cross-spill-sammenligning
- [SPILL_REGLER_OG_PAYOUT.md](../architecture/SPILL_REGLER_OG_PAYOUT.md) ← payout-mekanikk
- [SPILL1_IMPLEMENTATION_STATUS_2026-05-08.md](../architecture/SPILL1_IMPLEMENTATION_STATUS_2026-05-08.md) ← Spill 1 dyp implementasjon
- [SPILL2_IMPLEMENTATION_STATUS_2026-05-08.md](../architecture/SPILL2_IMPLEMENTATION_STATUS_2026-05-08.md) ← Spill 2 dyp implementasjon
- [SPILL3_IMPLEMENTATION_STATUS_2026-05-08.md](../architecture/SPILL3_IMPLEMENTATION_STATUS_2026-05-08.md) ← Spill 3 dyp implementasjon

---

## 4. Top-10 kritiske kommandoer

```bash
# 1. Onboarding-gate (første handling som ny PM)
cd /Users/tobiashaugen/Projects/Spillorama-system
bash scripts/pm-checkpoint.sh

# 2. Generer live current-state (3 min)
./scripts/pm-onboarding.sh > /tmp/pm-onboarding.md

# 3. Dev-stack full restart (Tobias rør aldri git — dette er ENESTE kommando han kjører)
cd /Users/tobiashaugen/Projects/Spillorama-system && npm run dev:nuke

# 4. Dev-stack med DB-observability (PgHero på :8080)
npm run dev:nuke -- --observability

# 5. Live-monitor + push-daemon (OBLIGATORISK ved testing)
bash scripts/start-monitor-with-push.sh
# I PM-terminal: tail -f /tmp/pilot-monitor-urgent.fifo

# 6. PM-flyt: opprett PR med auto-merge
gh pr create --title "..." --body "..."
gh pr merge <nr> --squash --auto --delete-branch

# 7. Verifiser CI 5-10 min etter PR-åpning
gh pr checks <nr>

# 8. Cancel stale runder (ved stuck-state — kombinert med FLUSHALL i dev:nuke)
PGPASSWORD=spillorama psql -h localhost -U spillorama -d spillorama -c "
UPDATE app_game1_scheduled_games SET status='cancelled', actual_end_time=now()
WHERE status IN ('running','purchase_open','ready_to_start','paused');"

# 9. Sentry-baseline ved sesjons-start
# Via Cowork-chat: "Vis åpne BIN-issues fra siste time, sorter på frekvens"

# 10. Sesjons-slutt (siste handling)
bash scripts/pm-session-end.sh
```

---

## 5. Kanoniske doc-pekere (per scope)

| Scope | Kanonisk doc | Tid å lese |
|---|---|---|
| Onboarding | [`PM_ONBOARDING_PLAYBOOK.md`](./PM_ONBOARDING_PLAYBOOK.md) | 60-90 min |
| Sesjons-start | [`PM_SESSION_START_CHECKLIST.md`](../operations/PM_SESSION_START_CHECKLIST.md) | 5 min |
| Sesjons-slutt | [`PM_SESSION_END_CHECKLIST.md`](../operations/PM_SESSION_END_CHECKLIST.md) | 5 min |
| Knowledge-export-mal | [`PM_SESSION_KNOWLEDGE_EXPORT_TEMPLATE.md`](../operations/PM_SESSION_KNOWLEDGE_EXPORT_TEMPLATE.md) | 10 min |
| Spill-regler | [`SPILL_REGLER_OG_PAYOUT.md`](../architecture/SPILL_REGLER_OG_PAYOUT.md) | 20 min |
| Spill-katalog | [`SPILLKATALOG.md`](../architecture/SPILLKATALOG.md) | 10 min |
| Robusthet-mandat | [`LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08.md`](../architecture/LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08.md) | 15 min |
| Fallgruve-katalog | [`PITFALLS_LOG.md`](./PITFALLS_LOG.md) | 10 min skim + 5-10 min for ditt scope |
| Agent-arbeid-historikk | [`AGENT_EXECUTION_LOG.md`](./AGENT_EXECUTION_LOG.md) | 5 min skim |
| ADR-katalog | [`docs/adr/README.md`](../adr/README.md) | 5 min |
| Engineering-workflow | [`ENGINEERING_WORKFLOW.md`](./ENGINEERING_WORKFLOW.md) | 15 min |
| Skill-doc-protokoll-mal | [`SKILL_DOC_PROTOCOL_TEMPLATE.md`](./SKILL_DOC_PROTOCOL_TEMPLATE.md) | 5 min |
| Auto-genererte (current state) | [`docs/auto-generated/`](../auto-generated/) | Skim ved behov |

---

## 6. Spillkatalog (vedtatt 2026-04-25)

| Markedsføring | Slug | Kategori | §11-prosent | Cap |
|---|---|---|---|---|
| Spill 1 | `bingo` | MAIN_GAME (Hovedspill) | 15% | Ingen |
| Spill 2 | `rocket` | MAIN_GAME | 15% | Ingen |
| Spill 3 | `monsterbingo` | MAIN_GAME | 15% | Ingen |
| **Spill 4 / SpinnGo** | `spillorama` (legacy: `game5`) | **DATABINGO** | **30%** | **2500 kr** |
| Candy | `candy` | Tredjeparts iframe | (ikke vårt ansvar) | N/A |

**Game 4 / `themebingo` er deprecated (BIN-496). Ikke bruk.**

**Single source mapping:** `apps/backend/src/game/ledgerGameTypeForSlug.ts` — bruk denne, hardkode ALDRI.

---

## 7. Pilot-status R1-R12 (per 2026-05-15 — sjekk auto-onboarding for siste)

| # | Tiltak | Status | Pilot-blokker |
|---|---|---|---|
| R1 | Lobby-rom Game1Controller-wireup | ✅ Merget | Nei |
| R2 | Failover-test (instans-restart) | ✅ PASSED 2026-05-08 | Nei |
| R3 | Klient-reconnect-test | ✅ PASSED 2026-05-08 | Nei |
| R4 | Load-test 1000 klienter | ⚠️ Ikke startet | Utvidelses-blokker |
| R5 | Idempotent socket-events | ✅ Implementert | Nei |
| R6 | Outbox for room-events | ⚠️ Delvis | Utvidelses-blokker |
| R7 | Health-endpoint per rom | ✅ Merget | Nei |
| R8 | Alerting (Slack/PagerDuty) | ✅ Slack-ready | Nei |
| R9 | Spill 2 24t-leak-test | ⚠️ Avventer | Utvidelses-blokker |
| R10 | Spill 3 phase-state-machine chaos | ⚠️ Engine-wireup levert | Utvidelses-blokker |
| R11 | Per-rom resource-isolation | ⚠️ Ikke startet | Utvidelses-blokker |
| R12 | DR-runbook for live-rom | ✅ Merget | Nei |

**Pilot-haller:** Teknobingo Årnes (master) + Bodø + Brumunddal + Fauske.

---

## 8. Anti-mønstre (top-10)

| ❌ Aldri | ✅ Gjør i stedet |
|---|---|
| Hardkode `gameType: "DATABINGO"` for Spill 1-3 | `ledgerGameTypeForSlug(slug)` |
| Bind compliance-ledger til `master_hall_id` | Bind til `actor_hall_id` (kjøpe-hall) |
| `git add -A` (kan plukke .env) | `git add path/to/file.ts` (eksplisitt) |
| Agent åpner PR | PM eier PR |
| Kjedede PR-er uten rebase mellom squash-merger | Rebase mot main etter hver merge ELLER combined PR |
| Direct INSERT i audit-tabeller | Bruk `AuditLogService.record()` |
| Endre eksisterende migration | Lag NY migration som korrigerer (forward-only) |
| Antar Spill 2/3 har master | De har IKKE master — perpetual-loop |
| Skipper §66-pause på server-side | Server håndhever; klient kan aldri overstyre |
| "Vi jobber med det" | "Her er løsningen innen [klokkeslett]" |

Full liste i [PM_ONBOARDING_PLAYBOOK §9](./PM_ONBOARDING_PLAYBOOK.md#9-anti-mønstre-og-fallgruver) og [PITFALLS_LOG.md](./PITFALLS_LOG.md).

---

## 9. Login-credentials (lokal dev)

| Rolle | E-post | Passord-hint | Hall |
|---|---|---|---|
| Admin | `tobias@nordicprofil.no` | Spillorama123! | (ingen) |
| Master-agent (demo) | `demo-agent-1@spillorama.no` | Samme | demo-hall-001 |
| Sub-agents 2-4 (demo) | `demo-agent-[2-4]@spillorama.no` | Samme | demo-hall-00[2-4] |
| Spiller 1-12 (demo) | `demo-pilot-spiller-[1-12]@example.com` | Samme | demo-hall-00[1-4] |

Tobias deler passord i chat (Anthropic-policy hindrer AI å fylle inn).

---

## 10. URL-er for testing

| URL | Hva |
|---|---|
| `http://localhost:5174/admin/` | Admin-konsoll |
| `http://localhost:5174/admin/agent/cashinout` | Master cash-inout dashboard |
| `http://localhost:4000/web/?dev-user=demo-pilot-spiller-1` | Spillerklient |
| `http://localhost:4000/api/games/spill1/health?hallId=demo-hall-001` | R7 health-endpoint |
| `http://localhost:8080` | PgHero DB-dashbord (kun med `--observability`) |
| `https://spillorama-system.onrender.com/` | Prod |

---

## 11. Når i tvil — hierarkiet for autoritet

1. **Tobias-direktiv i sanntid** (chat-melding under aktiv sesjon) — ALLTID høyest
2. **Kanonisk doc** (SPILL_REGLER, SPILL[1-3]_IMPLEMENTATION_STATUS, LIVE_ROOM_ROBUSTNESS_MANDATE, denne fila §1-tabell) — overstyrer kode
3. **ADR-er** (immutable etter merge; Superseded-by hvis overstyrt)
4. **Skills** (`.claude/skills/*/SKILL.md`) — invariants og fallgruver per domene
5. **PITFALLS_LOG** — kjente fallgruver med PR-referanser
6. **Kode** — sannhet for current state, men hvis i konflikt med 1-5 → fix koden
7. **Memory + PM_HANDOFFs** — kontekst for "hvorfor er det slik?"

Hvis 1-2 er i konflikt → spør Tobias. Han skriver doc-en (eller godkjenner ADR).

---

## 12. Daglig rutine (etter onboarding)

**Sesjons-start (5 min):**
1. `git pull origin main` (i hovedrepoet)
2. `./scripts/pm-onboarding.sh > /tmp/pm-onboarding.md` + les
3. Les siste `PM_HANDOFF_<dato>.md` og `PM_SESSION_KNOWLEDGE_EXPORT_<dato>.md` (begge fra forrige PM)
4. Hvis vanntett-gate ≥ 7 dager gammel: `bash scripts/pm-checkpoint.sh`
5. Hvis du skal teste: `bash scripts/start-monitor-with-push.sh`

**Under arbeid:**
- Hver fix-agent-prompt → inkluder skill-doc-protokoll (§2.19, mal i SKILL_DOC_PROTOCOL_TEMPLATE)
- Hver PR-merge → gi Tobias `npm run dev:nuke`-kommando
- Hver merge → verifiser CI 5-10 min senere
- Hvis ≥ 3 PR-er feiler samme måte → INFRA-bug, root-cause-fix først
- Hver beslutning som påvirker ≥ 2 services → skriv ADR

**Sesjons-slutt (15-30 min):**
1. `bash scripts/pm-session-end.sh` (interaktiv, validerer Trinn 1-8)
2. PM_HANDOFF skrevet
3. PM_SESSION_KNOWLEDGE_EXPORT skrevet (mens kontekst er fersk)
4. Eventuelle nye fallgruver lagt i PITFALLS_LOG
5. Skills oppdatert med ny kunnskap
6. AGENT_EXECUTION_LOG entry per agent-leveranse

---

## Vedlikehold av denne fila

**Når oppdater:**
- Ny IMMUTABLE direktiv fra Tobias → §1 + dato
- Ny gate/script → §2
- Ny pilot-status R-tiltak → §7
- Nye kommandoer som bør være top-10 → §4
- Stale doc-pekere → §5

**Når IKKE oppdater:**
- Daglig task-tracking (det er Linear)
- Sesjons-spesifikke detaljer (legg i HANDOFF/KNOWLEDGE_EXPORT)
- Detaljerte forklaringer (de hører i playbook)

**Format:** Hold under 3 sider. Hvis seksjon blir for stor → splitt ut til egen doc og lenk hit.

---

## Endringslogg

| Dato | Endring | Forfatter |
|---|---|---|
| 2026-05-15 | Initial — opprettet som hurtigreferanse for daglig PM-bruk. Konsoliderer essensen fra `PM_ONBOARDING_PLAYBOOK.md` (~30 sider) til 3 sider. Inkluderer Tobias' kontinuitet-direktiv (§0) som er IMMUTABLE for ny PM. | PM-AI (Claude Opus 4.7) |
