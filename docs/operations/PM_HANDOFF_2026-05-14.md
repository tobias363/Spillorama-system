# PM-handoff 2026-05-14 — Evolution-grade DB-observability + Next Game Display-bug

**Forrige PM:** Claude Opus 4.7 (Cowork-sesjon 2026-05-14)
**Ny PM:** [Navn settes ved overtagelse]
**Sesjons-tema:** Evolution-grade DB-observability komplett. Neste sesjon må løse Next Game Display-bug (kritisk, tilbakevendende).
**Status pilot-go-live:** Klart fra observability-siden. **Blokker:** Next Game Display-bug må løses før produksjon.

---

## 0. ⛔ FØR DU GJØR NOEN TING — Onboarding-gate (vanntett)

**Tobias-direktiv 2026-05-10 (IMMUTABLE):** Du har **FORBUD** mot å skrive kode før du har passert PM-onboarding-gate. Dette er hard-håndhevet via:
- Pre-commit hook (lokal blokk)
- PR-merge workflow (GitHub-blokk)
- PM-Playbook §3 trinn 0

```bash
cd /Users/tobiashaugen/Projects/Spillorama-system
bash scripts/pm-checkpoint.sh --validate    # exit 0 = passert, exit 1 = kjør gaten
```

Hvis exit ≠ 0:

```bash
bash scripts/pm-checkpoint.sh
```

**Gaten krever:** Per-fil-bekreftelse av ALLE `docs/operations/PM_HANDOFF_*.md` siden 2026-04-23 med 1-3 setninger fri-tekst-takeaway per fil. Filen `.pm-onboarding-confirmed.txt` skrives til repo-rot som bevis. Gyldig 7 dager.

**Hvorfor:** Tidligere PM-er har hoppet over eldre handoffs og gjentatt fallgruver som var dokumentert. Tobias-direktiv:
> "Det er ekstremt viktig at vi setter den rutinen slik at man alltid leser ALL dokumentasjon — slik at man har all kontekst og ikke går i de samme fallgruvene som tidligere."

Hopp ALDRI over dette steget.

---

## 1. Hovedoppgave (KRITISK, P0)

### 🚨 Next Game Display-bug — tilbakevendende, må løses 100%

**Problem-statement (Tobias 2026-05-14):**

> "Det handler om at når nuke kjøres og backend nullstilles og man logger inn i admin backend så skal da alltid første spill på planen vises — uavhengig av hvilken status hallen har satt (om de er klar, ingen kunder eller ikke satt status enda). Etter at første spill er spilt må man gå videre til neste spill på lista. Dette har vi prøvd å få til utallige ganger nå uten at vi lykkes."

**Forventet adferd:**

| State | Master-konsoll skal vise |
|---|---|
| Etter `dev:nuke` (ingen runde startet enda) | "Neste spill: Bingo" (item 1 i `demo-plan-pilot`) |
| Bingo er ferdig (status='finished') | "Neste spill: <item 2 i plan>" |
| Item 2 ferdig | "Neste spill: <item 3>" |
| Alle 13 items ferdig | "Plan fullført for dagen" |

**Skal IKKE være avhengig av:**
- Hall-ready-status (master har trykket klar / ikke)
- Antall kunder i hallen
- Auto-cron-status

**Tidligere fix-forsøk (kontekst, IKKE løst problemet helt):**
- PR #1422 — BUG E auto-advance plan-run fra finished (PM follow-up: PLAN_COMPLETED_FOR_TODAY-avvisning)
- PR #1427 — Master-UI header state-aware (Tobias-rapport 3 ganger 2026-05-14)
- PR #1431 — Lobby-API nextGame for finished plan-run (komplementært til #1422)
- PR #1370 — Plan-meta vises uansett status før plan-run opprettes
- Mange andre incrementelle fixes — se `git log --oneline --grep="plan-run\|lobby\|Bingo"`

Bug-en kommer tilbake fordi vi mangler **én sentral kilde til sannhet** for "neste spill skal vises som X". Forskjellige kode-paths (lobby-API, master-UI, NextGamePanel, GameLobbyAggregator) implementerer egen logikk som driver fra hverandre over tid.

### Tobias' beslutning 2026-05-14 — UTSETT PILOT HVIS NØDVENDIG

> "Vi må nå ha et helt åpent sinn hvor vi ser på funksjonaliteten og hvis vi finner ut at dette må bygges som og det utsetter pilot med uker så er vi nødt til å gjøre det."

**Kvalitet > tid.** Ny PM har grønt lys for å bruke 1-4 uker hvis nødvendig.

### Plan for løsning (3 trinn)

**Trinn 1: Maksimal data-innsamling (1-2 dager)**

Spawn 6 parallelle research-agenter (worktree-isolert via `isolation: "worktree"`) som hver mapper ut sin del:

| Agent | Scope |
|---|---|
| **A** | Frontend rendering — `Spill1HallStatusBox.ts` + `NextGamePanel.ts` + `Game1Controller.ts` + alle pages som rendrer "neste spill"-tekst |
| **B** | Backend aggregator — `GameLobbyAggregator.ts` + `Game1LobbyService.ts` + alle steder som beregner `nextScheduledGame` / `nextGame` / `plan.items[currentPosition + 1]` |
| **C** | Plan-run state-machine — `GamePlanRunService.ts` + `GamePlanEngineBridge.ts` + `MasterActionService.ts` (start/advance/finish-flyt) |
| **D** | Scheduled-game lifecycle — `Spill1ScheduledGameRepo` + `Game1ScheduleTickService` (cron auto-flip) + `Game1MasterControlService` (engine.startGame) |
| **E** | Historisk arv — les ALLE PR-er siden 2026-04-23 som rører plan-runtime/lobby/next-game (~30-50 PR-er). Lag tidslinje av hva hver fix prøvde + hvor det glapp |
| **F** | Test-coverage — finn alle eksisterende vitest/integration-tester som tester denne flyten. Map til state-machine. Identifiser huler |

Hver agent leverer en `data-collection.md` som inkluderer:
- Komplett fil-liste (file:line)
- Kall-graf (hvilken funksjon kaller hva)
- State-overganger (hvilken status → hvilken next-display)
- Kjente edge-cases (fra tester eller PITFALLS)

**Trinn 2: Konsolider i master-doc (1 dag)**

Lag `docs/architecture/NEXT_GAME_DISPLAY_FUNDAMENT_AUDIT_2026-05-XX.md` med:
1. **Problem-statement** (kopier fra denne handoff)
2. **Komplett state-machine** — alle states (idle/scheduled/purchase_open/ready_to_start/running/paused/finished/cancelled/no-plan-run-exists) × (master_hall_ready/not_ready/no_data) × (klient er master/sub-agent/spiller)
3. **Komplett kall-graf** — hver state-overgang viser eksakt hvilken kode-path som kjører
4. **Forventet display per state** — én tabell som har 100% dekning
5. **Identifiserte bugs** — hvilke state-overganger faller mellom paths (frontend leser X, backend returnerer Y)
6. **Foreslått modulær arkitektur** — én autoritativ service for "neste spill"-logikk, alle frontend leser fra samme kilde
7. **Test-plan** — invariants og scenarier som MÅ dekkes

**Trinn 3: Refaktorering (1-3 uker, kvalitet > tid)**

Basert på master-doc:
- Implementér én autoritativ `NextGameDisplayService` (eller utvid eksisterende `GameLobbyAggregator`)
- Slett DUPLISERT logikk i frontend (`Spill1HallStatusBox` + `NextGamePanel` skal bare RENDRE, ikke beregne)
- Skriv minst 30 tester som dekker hele state-machine
- E2E-test mot fresh stack: `dev:nuke` → admin-login → verifiser "Neste spill: Bingo" → fullfør Bingo → verifiser advance til next
- Tobias kjører manuell smoke-test før merge

### Verktøy som allerede er klare for data-innsamling

| Verktøy | Hva | Bruk |
|---|---|---|
| `pilot-monitor` | Live-event-stream fra backend | Spawnes som background-agent, dump til `/tmp/pilot-monitor.log` |
| Round-replay-API (PR #1424) | `GET /api/_dev/debug/round-replay/:id?token=...` | Komplett scheduled-game-timeline |
| Frontend State Dump (PR #1425) | "Dump State"-knapp i debug-HUD | Dumper komplett klient-state-tree |
| Postgres MCP (lokal) | `postgres-spillorama` (write-capable) | Direct SQL-spørringer mot lokal DB |
| Postgres MCP (prod) | `postgres-spillorama-prod` (read-only) | Kun SELECT mot prod |
| Sentry MCP | `mcp__15c870cf-...` | Søk i issues, hent stack-traces |
| db-perf-watcher (live cron) | Hver 5 min | Logger query-anomalier |
| wallet-integrity-watcher (live cron) | Hver 1 t | Hash-chain + balance-sjekk |

Hvis flere data-innsamlingsverktøy trengs — la TOBIAS få beskjed og bygg dem først.

---

## 2. Sesjons-leveranse 2026-05-14 (kontekst for ny PM)

**9 PR-er merget i én dag** — komplett Evolution-grade DB-observability:

| PR | Tema | Effekt |
|---|---|---|
| #1454 | PM Playbook §2.20 + §2.21 | Sentry+PostHog ALLTID + DB-overvåking 4-lag |
| #1455 | **G** ADR-0023 MCP write-access policy | Prod-DB READ-ONLY via MCP, append-only audit-mønster |
| #1456 | **B** db-perf-watcher cron (OBS-9) | pg_stat_statements anomaly-deteksjon, Linear auto-issue |
| #1459 | **C** wallet-integrity-watcher (OBS-10) | Hash-chain + balance-sum cron, Linear auto-issue |
| #1460 | **D** synthetic bingo-test (R4-precursor) | I1-I6 invariants, 59 vitest-tester |
| #1463 | ADR-0023 schema-korreksjon | Faktiske tabellnavn (wallet_accounts/wallet_entries/app_audit_log) |
| #1465 | INFRA-fix auto-doc PR-flyt | Workflow åpner PR istedenfor direct-push til protected main |
| #1425 | Frontend State Dump tool | Debug-HUD-knapp som dumper klient-state |
| #1467 | Synthetic-bot accessToken-fix | room:join fungerer for synthetic-test |

**Cleanup:** 60+ falske CI-failure-issues lukket (alle samme rot-årsak fra pre-existing INFRA-bug, nå fikset i #1465).

**Verifisert mot prod:**
- ✅ `pg_stat_statements` aktivert i Render Postgres (v1.12, 383 queries aktivt sporet)
- ✅ Begge MCP-er konfigurert: lokal write-capable, prod read-only
- ✅ Linear API-key i `secrets/linear-api.local.md` — virker mot BIN-team
- ✅ Watchere kjører som launchd-jobs (db-perf hver 5 min, wallet-integrity hver 60 min)

---

## 3. Aktivert infrastruktur (kjører nå)

### Cron-watchere (launchd, lokal Mac)

```bash
# Status:
bash scripts/ops/setup-db-perf-cron.sh status
bash scripts/ops/setup-wallet-integrity-cron.sh status

# Stop:
bash scripts/ops/setup-db-perf-cron.sh uninstall
bash scripts/ops/setup-wallet-integrity-cron.sh uninstall

# Logs:
tail -f /tmp/db-perf-watcher-cron.log
tail -f /tmp/wallet-integrity-watcher-cron.log
```

**MTTD-stack på pilot-prod:**
- B: pg_stat_statements anomalier — < 5 min
- C: wallet-mismatch + hash-chain — < 1 t
- WalletAuditVerifier (eksisterende, nattlig) — full SHA-256 re-compute

### Sentry + PostHog (live i prod)

- Sentry-org: `spillorama` (region: de.sentry.io)
- PostHog: koblet via MCP `mcp__9cff3a7d-...`
- §2.20 i PM_ONBOARDING_PLAYBOOK krever ALLTID-aktiv overvåking under testing

### Linear-integrasjon

- API-key: `secrets/linear-api.local.md` (gitignored, kun lokal)
- Team-key: `BIN`
- Watcherne auto-creates issues med 24t dedup

---

## 4. Lavt-prioritet gjenstående (ikke pilot-blokker)

### 🟡 Synthetic-test Fix #2 — bet:arm-refactor (1-2 dager)

**Status:** Fix #1 (accessToken socket-payload) er levert i PR #1467. Fix #2 dokumentert som tech-debt.

**Hva må gjøres:**
Synthetic-bot's HTTP `/api/game1/purchase`-vei feiler med `PURCHASE_CLOSED_FOR_GAME` fordi `master/start` går rett til `running`. Pilot-flyten forventer `bet:arm`-socket-event FØR master/start.

**Refactor:**
1. Erstatt HTTP-purchase med socket `bet:arm`-event
2. Send bet:arm FØR master/start (mens scheduled-game ikke eksisterer enda)
3. `Game1ArmedToPurchaseConversionService` konverterer armed → purchases når master starter

**Fil-paths:** `scripts/synthetic/spill1-round-bot.ts` + ny `scripts/synthetic/bet-arm-client.ts`

### 🟡 Pre-existing tech-debt — stale tabellnavn i 2 skills

- `.claude/skills/wallet-outbox-pattern/SKILL.md` linje 3 (description), 68 (ASCII-diagram), 144 (intro)
- `.claude/skills/pengespillforskriften-compliance/SKILL.md` linje 74

Disse refererer til `app_compliance_audit_log` som IKKE eksisterer i DB. Faktisk: `app_audit_log`.

**Fix:** Sed-replace eller manuell oppdatering. Trivielt arbeid.

### 🟡 PR #1360 (SKILL_FILE_MAP auto-regen) — venter

Auto-merge satt men har sittet med `mergeable: UNKNOWN`-quirk. Workflow-only-fil, lavt risk. Kan trigges via no-op commit eller manuel UI-merge.

### 🟡 27 eldre falske CI-failure-issues fra pre-pilot-perioden

Pre-pilot CI-failure-issues som ikke ble batch-lukket. Kan ryddes opp i én sesjon hvis ønskelig.

```bash
# Batch-close:
for ISSUE in $(gh api repos/tobias363/Spillorama-system/issues --paginate=false -q '[.[]|select(.state=="open" and (.title|startswith("CI failure on main")))]|.[]|.number'); do
  gh issue close "$ISSUE" --comment "Pre-pilot batch-cleanup."
done
```

---

## 5. Tobias' IMMUTABLE direktiver (må følges 100%)

Disse er bekreftet med Tobias og kan ALDRI fravikes uten eksplisitt godkjenning:

### 5.1 Quality > speed (2026-05-05)
> "Ingen deadline, kvalitet over hastighet. All død kode skal fjernes."

### 5.2 Tobias rør ALDRI git lokalt
PM eier `git pull` etter hver merge. Tobias bare refresher nettleseren.

### 5.3 dev:nuke alltid etter merge (2026-05-11)
Standard restart-kommando — ALLTID med `cd /Users/...` først:
```bash
cd /Users/tobiashaugen/Projects/Spillorama-system && npm run dev:nuke
```
Aldri selective restart (admin-web only osv) — `dev:nuke` garanterer clean state på tvers av alle lag.

### 5.4 PM-sentralisert git-flyt (ADR-0009)
- **Agenter:** commit + push feature-branch — ALDRI opprett PR eller merge
- **PM (deg):** `gh pr create` + `gh pr merge --squash --auto --delete-branch`

### 5.5 Done-policy (ADR-0010)
Issue lukkes KUN når:
1. Commit MERGET til `main`
2. `file:line`-bevis (eksakt path)
3. Test/CI verifiserer atferd

### 5.6 §2.19 IMMUTABLE skill-doc-protokoll (2026-05-14)
**HVER fix-agent-prompt PM sender** MÅ inneholde "Dokumentasjons-protokoll"-seksjon som krever:
- Skill-update i `.claude/skills/<relevant>/SKILL.md`
- PITFALLS_LOG-entry i `docs/engineering/PITFALLS_LOG.md`
- AGENT_EXECUTION_LOG-entry i `docs/engineering/AGENT_EXECUTION_LOG.md`

Alle i SAMME PR. Uten dette går vi "2 skritt frem og 1 tilbake".

**Reusable template:** `docs/engineering/SKILL_DOC_PROTOCOL_TEMPLATE.md`

### 5.7 PM verifiser CI etter PR-åpning (2026-05-09)
Auto-merge fyrer KUN ved ekte CI-grønning. Etter ny PR + auto-merge: sjekk `gh pr checks <nr>` etter 5-10 min. Hvis ≥ 3 PR-er feiler samme måte → INFRA-bug → root-cause-fix først.

### 5.8 Skill-loading lazy per-task (2026-04-25)
Last KUN skills når du SELV redigerer kode i det domenet. Skip for ren PM/orkestrering eller delegert agent-arbeid.

### 5.9 Live-monitor ALLTID aktiv ved testing (2026-05-13)
Når PM eller Tobias starter en test-sesjon, MÅ live-monitor-agent være aktiv som FØRSTE handling. Spawn-mal i PM_ONBOARDING_PLAYBOOK §2.18.

### 5.10 Parallelle agenter — grønt lys uten å spørre (2026-05-13)
PM-AI kan spawne så mange parallelle agenter som hensiktsmessig. Krav: klart scope, ingen fil-kollisjon, AGENT_EXECUTION_LOG oppdateres per leveranse. **Bruk `isolation: "worktree"` ved ≥ 2 parallelle agenter på samme repo** for å unngå file-revert-konflikter.

### 5.11 Plan C: én måned ekstra OK ved strukturelle bugs (2026-05-13)
Hvis BUG_CATALOG viser ≥ 3 strukturelle bugs i pilot-kode, godkjent å bruke inntil 1 måned ekstra på arkitektur-rewrite. **Next Game Display-bug faller inn under dette mandatet.**

### 5.12 ADR-0023 MCP write-access policy (NY 2026-05-14)
- Lokal dev-DB: WRITE OK via `uvx postgres-mcp --access-mode=unrestricted`
- Prod-DB: READ-ONLY FOREVIG via `@modelcontextprotocol/server-postgres`
- Korreksjoner i prod: append-only via migration-PR

---

## 6. Obligatorisk lesing (i denne rekkefølgen)

### Tier 1 — Lese FØRST (≈ 90 min)

1. **`docs/engineering/PM_ONBOARDING_PLAYBOOK.md`** (Tier 1 doc, 73k tegn) — Hele §1-§11
2. **`docs/engineering/PITFALLS_LOG.md`** — Skim hele + dykk på §1-§4 + §7 + §11
3. **`docs/engineering/AGENT_EXECUTION_LOG.md`** — Skim siste 30 entries (gir kontekst om hva som er gjort 2026-05-13/14)
4. **DENNE handoff-en** i sin helhet
5. **`docs/operations/PM_HANDOFF_2026-05-13.md`** + `_PART2` + `_PART3` + `_AUTONOMY_COMPLETE` — forrige sesjons-handoff

### Tier 2 — Next Game Display-bug-spesifikt

6. **`docs/architecture/SPILL1_IMPLEMENTATION_STATUS_2026-05-08.md`** — Master-flyt, plan-runtime, scheduled-game lifecycle
7. **`docs/architecture/PLAN_SPILL_KOBLING_FUNDAMENT_AUDIT_2026-05-08.md`** — Tidligere audit på samme tema
8. **`docs/architecture/LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08.md`** — Evolution-grade krav
9. **`docs/adr/0009-pm-centralized-git-flow.md`** + `0010-done-policy-legacy-avkobling.md` + `0017-remove-daily-jackpot-accumulation.md` + `0019-evolution-grade-state-consistency-bolge1.md` + `0021-allow-master-start-without-players.md` + `0022-stuck-game-recovery-multilayer.md` — relevante beslutninger

### Tier 3 — Compliance + observability (du må kjenne)

10. **`docs/architecture/SPILL_REGLER_OG_PAYOUT.md`** + **`SPILLKATALOG.md`** — kanoniske regel-doc-er
11. **`docs/adr/0023-mcp-write-access-policy.md`** (ny 2026-05-14) — MCP write-policy
12. **`docs/operations/DB_PERF_WATCHER_RUNBOOK.md`** + **`WALLET_INTEGRITY_WATCHER_RUNBOOK.md`** + **`SYNTHETIC_BINGO_TEST_RUNBOOK.md`** — watcher-runbooks

### Auto-genererte (alltid friske)

13. **`docs/auto-generated/MIGRATIONS_LOG.md`** — DB-migration-historikk
14. **`docs/auto-generated/MODULE_DEPENDENCIES.md`** — backend-domene-graf
15. **`docs/auto-generated/API_ENDPOINTS.md`** — alle 227+ endpoints

---

## 7. Rutiner du må følge

### 7.1 Sesjons-start (10 min)

```bash
cd /Users/tobiashaugen/Projects/Spillorama-system

# 1. Verifiser PM-gate
bash scripts/pm-checkpoint.sh --validate

# 2. Generer current-state-rapport
./scripts/pm-onboarding.sh > /tmp/pm-onboarding.md
cat /tmp/pm-onboarding.md

# 3. Sjekk dev-stack helse
curl -s http://localhost:4000/health | head -c 200
docker ps | grep spillorama

# 4. Sjekk åpne PR-er + CI-status
gh pr list --state open --limit 10

# 5. Sjekk watcher-status (B+C)
bash scripts/ops/setup-db-perf-cron.sh status
bash scripts/ops/setup-wallet-integrity-cron.sh status

# 6. Verifiser Linear API
LINEAR_API_KEY=$(grep LINEAR_API_KEY= secrets/linear-api.local.md | cut -d= -f2)
curl -s -X POST https://api.linear.app/graphql \
  -H "Authorization: $LINEAR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"query":"{ viewer { name } }"}'
```

### 7.2 Før hver agent-spawn (KRITISK §2.19)

**HVER agent-prompt PM sender** MÅ inneholde:

```
## Dokumentasjons-protokoll (IMMUTABLE §2.19)

Du MÅ levere i SAMME PR:

1. Skill-update i `.claude/skills/<relevant-skill>/SKILL.md`
   - Ny seksjon eller v-bump med beskrivelse av hva som er endret
   - Endringslogg-entry med dato

2. PITFALLS_LOG-entry i `docs/engineering/PITFALLS_LOG.md`
   - Hvis du oppdaget en ny fallgruve → legg til entry i passende §
   - Oppdater indeks-tabell + total count

3. AGENT_EXECUTION_LOG-entry i `docs/engineering/AGENT_EXECUTION_LOG.md`
   - Detaljert leveranse-beskrivelse med fil-paths + test-count
   - Lessons learned (KRITISK for neste agent)

Mangler dette i PR → PM lager follow-up-commit FØR merge.

Reusable template: `docs/engineering/SKILL_DOC_PROTOCOL_TEMPLATE.md`
```

### 7.3 Etter PR-merge

```bash
# 1. Pull main
cd /Users/tobiashaugen/Projects/Spillorama-system
git checkout main
git pull --rebase --autostash

# 2. Verifiser merge
git log --oneline -3

# 3. Gi Tobias dev:nuke-kommando (§5.3)
echo "cd /Users/tobiashaugen/Projects/Spillorama-system && npm run dev:nuke"

# 4. Sjekk CI på main 5-10 min etter
gh run list --branch main --limit 3
```

### 7.4 Sesjons-slutt (OBLIGATORISK)

**Du må skrive `docs/operations/PM_HANDOFF_YYYY-MM-DD.md` FØR du logger av.** Format:
- Tobias-direktiver fra sesjonen
- Hva som er ferdig (PR-er merget, tester pass)
- Hva som gjenstår (med presis status + estimat)
- Anti-mønstre du oppdaget
- Konkrete handlinger for neste PM
- Lessons learned

**Oppdater også:**
- `docs/engineering/PM_ONBOARDING_PLAYBOOK.md` §11.5 endringslogg
- `docs/engineering/PITFALLS_LOG.md` hvis nye fallgruver funnet
- `docs/engineering/AGENT_EXECUTION_LOG.md` hvis agenter ble brukt

**Tobias-direktiv 2026-05-09:**
> "Det er greit at PM kan gjøre endringer i playbook utifra hva de gjør. Dette dokumentet skal være flytende — PM må alltid oppdatere med hva som er gjort slik at ny PM etter alltid har samme kunnskap som forrige PM."

---

## 8. Tekniske referanser

### 8.1 Pilot-haller (4 stk, første runde)

| Hall | UUID | Rolle |
|---|---|---|
| Teknobingo Årnes | `b18b7928-3469-4b71-a34d-3f81a1b09a88` | Master |
| Bodø | `afebd2a2-52d7-4340-b5db-64453894cd8e` | Deltaker |
| Brumunddal | `46dbd01a-4033-4d87-86ca-bf148d0359c1` | Deltaker |
| Fauske | `ff631941-f807-4c39-8e41-83ca0b50d879` | Deltaker |

Demo-haller (`demo-hall-001..004`) brukes for staging-test.

### 8.2 Demo-credentials (lokal)

| Rolle | E-post | Passord |
|---|---|---|
| Admin | `tobias@nordicprofil.no` | `Spillorama123!` |
| Master-agent | `demo-agent-1@spillorama.no` | `Spillorama123!` |
| Spiller | `demo-pilot-spiller-1@example.com` | `Spillorama123!` |

### 8.3 URLer

| URL | Hva |
|---|---|
| `http://localhost:5174/admin/` | Admin-konsoll |
| `http://localhost:5174/admin/agent/cashinout` | Master cash-inout |
| `http://localhost:4000/web/?dev-user=demo-pilot-spiller-1` | Spillerklient |
| `https://spillorama-system.onrender.com/` | Prod |

### 8.4 R1-R12 pilot-gating-status (per 2026-05-09)

| # | Tiltak | Status |
|---|---|---|
| R1 | Lobby-rom Game1Controller-wireup | ✅ Merget #1018 + #1033 |
| R2 | Failover-test | ✅ PASSED 2026-05-08 |
| R3 | Klient-reconnect-test | ✅ PASSED 2026-05-08 |
| R4 | Load-test 1000 klienter | ⚠️ Ikke startet (utvidelses-blokker) |
| R5 | Idempotent socket-events | ✅ Implementert (BIN-813) |
| R6 | Outbox for room-events | ⚠️ Wallet-side ferdig, rom-side avventer |
| R7 | Health-endpoint per rom | ✅ Merget #1027 |
| R8 | Alerting (Slack/PagerDuty) | ✅ Merget #1031 |
| R9 | Spill 2 24t-leak-test | ⚠️ Infra klar, må kjøres |
| R10 | Spill 3 phase-state-machine | ⚠️ Engine-wireup levert, chaos avventer |
| R11 | Per-rom resource-isolation | ⚠️ Ikke startet |
| R12 | DR-runbook | ✅ Merget #1025 |

**Pilot-gating gjenstår etter denne sesjon:** R4, R6, R9, R10, R11 — alle utvidelses-blokkere, ikke pilot-go-live-blokkere.

**Pilot-blokker:** Next Game Display-bug (§1 i denne handoff).

---

## 9. Sentry-aktive feil (per 2026-05-14)

Sjekk Sentry MCP for current-state:

```
search_issues(orgSlug='spillorama', query='is:unresolved', limit=10)
```

Kjente issues (per tidligere sesjon):
- SPILLORAMA-BACKEND-5 — `terminating connection due to administrator command` (N+1 query-relatert)
- 6 andre unresolved (sjekk current state)

---

## 10. Anti-mønstre å unngå

### 10.1 Git
- ❌ `git add -A` — bruk eksplisitt file-list
- ❌ `--no-verify` på commit
- ❌ Agent åpner PR — PM eier PR
- ❌ `gh pr merge --merge` — bruk `--squash --auto`
- ❌ Kjedede PR-er uten rebase mellom hver merge (gir CONFLICTING)

### 10.2 Compliance
- ❌ Hardkode `gameType: "DATABINGO"` for Spill 1-3 — bruk `ledgerGameTypeForSlug(slug)`
- ❌ Apply 2500 kr cap på MAIN_GAME
- ❌ Direct UPDATE av audit-tabeller — bruk append-only correction-rad

### 10.3 Next Game Display (NY anti-mønster fra denne handoff)
- ❌ La frontend (Spill1HallStatusBox / NextGamePanel) beregne "neste spill"-tekst selv
- ❌ Lag separate kode-paths for "ingen plan-run" vs "plan-run finished" vs "ny plan-run idle"
- ❌ Inkrementelle fixes uten å konsolidere først
- ✅ Én autoritativ service som returnerer `nextGameToShow: { catalogSlug, displayName, position }`
- ✅ Frontend KUN renderer fra denne service

### 10.4 Master-handling (Tobias 2026-05-08, IMMUTABLE)
- ✅ Master kan starte/stoppe uavhengig av om andre haller er ready (ready-status er KUN informativ)
- ❌ Master kan IKKE hoppe over neste spill i sekvensen
- ❌ Ingen "Avbryt spill"-knapp for master (flyttet til admin-only)
- ❌ Ingen "Kringkast Klar + 2-min countdown"

---

## 11. Direkte kommunikasjon med Tobias

**Match hans stil eller mister tillit:**

| Signal | Hva han mener | Riktig respons |
|---|---|---|
| "Vi må…" | DO IT NOW | Ikke diskuter, ikke planlegg om |
| "unødvendig mye…" | Arkitektur-refaktor trengs | Foreslå konkret refaktor + estimat |
| "vi må få fremgang nå" | STOP iterasjon | Foreslå alternativ tilnærming |
| "feil at vi ikke har dette på plass" | Manglende fundament | Lag det FØR videre arbeid |
| "kjør på" | GO — ingen flere spørsmål | Bare gjør det |
| "du har gjort en meget god jobb" | Sterkt tilfreds | Fortsett kursen |

**Ikke si "vi jobber med det"** — si "her er løsningen innen [klokkeslett]".

---

## 12. Sjekkpunkter for fullført onboarding

Du er klar når du kan svare JA på alle:

### Onboarding-gate
- [ ] `bash scripts/pm-checkpoint.sh --validate` returnerer exit 0
- [ ] Jeg har lest ALLE handoffs siden 2026-04-23 + skrevet takeaway per fil
- [ ] `.pm-onboarding-confirmed.txt` finnes i repo-rot

### Fundament
- [ ] Jeg har lest §1-§11 i PM_ONBOARDING_PLAYBOOK
- [ ] Jeg vet alle 12 IMMUTABLE direktiver
- [ ] Jeg vet forskjellen mellom Spill 1, 2, 3 (rom-modell, master, perpetual)
- [ ] Jeg vet at Spill 4 = SpinnGo = databingo (ikke hovedspill)

### Next Game Display-bug
- [ ] Jeg har lest §1 i denne handoff
- [ ] Jeg har en plan for trinn 1 (data-innsamling)
- [ ] Jeg vet hvilke 6 områder agentene skal mappe ut
- [ ] Jeg er forberedt på 1-4 ukers arbeid (kvalitet > tid)

### Workflow
- [ ] Jeg vet hvordan PM-sentralisert git-flyt fungerer
- [ ] Jeg vet at `dev:nuke` alltid kjøres etter merge (§5.3)
- [ ] Jeg vet at §2.19 skill-doc-protokoll er IMMUTABLE i HVER agent-prompt

### Pilot
- [ ] Jeg vet R1-R12 status
- [ ] Jeg vet at pilot-omfang er 4 haller
- [ ] Jeg vet at Next Game Display-bug er ENESTE pilot-blokker fra utvikler-siden

### Tekniske detaljer
- [ ] Jeg vet at server er sannhets-kilde, klient er view
- [ ] Jeg vet outbox-pattern (state + event i samme TX)
- [ ] Jeg vet hash-chain audit-trail (BIN-764)
- [ ] Jeg vet ADR-0023 (MCP write-policy)

### Action-readiness
- [ ] Jeg har konkret plan for sesjonen (trinn 1: spawne 6 research-agenter)
- [ ] Jeg har spørsmålsliste til Tobias for uklarheter
- [ ] Jeg vet hva som er neste handling
- [ ] Jeg har grønt lys fra Tobias før jeg starter ikke-reverserbar handling

---

## 13. Lessons learned fra forrige PM (2026-05-14-sesjon)

### Det som funket
1. **Spawn agenter med konkrete skjema-fakta hardkodet i prompt** — sparer 20+ min lett-tid. C-agenten (wallet-integrity) verifiserte schema med `\d` FØR query-skriving og fant at min prompt hadde feil tabellnavn.
2. **PR-flyt for auto-genererte docs** — Direct push til protected main feiler med GH006. Bruk `peter-evans/create-pull-request@v7`.
3. **Dedup-window for Linear-alerts** — 24t per wallet-id/queryid forhindrer spam ved gjentakende anomalier.
4. **Worktree-isolasjon ved parallelle agenter** — `isolation: "worktree"` unngår file-revert-konflikter.
5. **DRY_RUN-mode i Linear-issue-creator** — verifiserer integrasjon uten å spamme team.

### Det som glapp
1. **C-agent stallet på "examining wallet schema"** — for åpen prompt. Re-spawn med konkrete fil-paths løste det.
2. **Synthetic-test antok feil flow** — `master/start` går rett til `running`, ikke via `purchase_open`. Pilot-flyten bruker `bet:arm` socket-event. Synthetic-bot trenger refactor (1-2 dager).
3. **Schema-mismatch i ADR-0023-eksempler** — jeg brukte `app_wallets`/`app_wallet_entries` (gjette-navn). Faktisk: `wallet_accounts`/`wallet_entries`. Verifiser DB-skjema med `\d` FØR du skriver SQL-eksempler.
4. **`balance` er GENERATED ALWAYS** — DB avviser direct UPDATE av `wallet_accounts.balance`. Korreksjon må gå via append `wallet_entries`-rad.
5. **Kjedede PR-er skaper CONFLICTING-state** — Etter squash-merge får branch en ny SHA. Andre kjedede PR-er mot samme branch må rebases. Bruk combined PR fra start hvis mulig.

### Mønstre å bruke for ny PM
1. **Sentral investigation-doc først, agenter etter** — for store debug-problemer (som Next Game Display) lag `docs/architecture/<TOPIC>_AUDIT_<DATE>.md` med problem-statement + fakta-liste FØR du spawner agenter. Da har du klar slot for konsolidering.
2. **Frontend State Dump (PR #1425)** — bruk knappen i debug-HUD for å fange klient-state ved hver bug-investigation. `pricingSourcesComparison`-feltet flagger "divergent" som rødt flag.
3. **Round-replay-API (PR #1424)** — `GET /api/_dev/debug/round-replay/:scheduledGameId?token=...` gir komplett timeline + anomaly-deteksjon. Erstatter 5-10 SQL-queries per debug.

---

## 14. Slik kontakter du Tobias

- **Direkte direktiver** — han spør konkret, svar konkret
- **Ingen lange essays** — kort, handlings-orientert
- **Frustrasjons-signaler** trigger PIVOT (ikke beklagelse)
- **Tillits-signaler** ("kjør på", "meget god jobb") — fortsett kursen
- **API-keys** — han deler direkte i chat. Forventer at du legger inn i `secrets/`-mappen
- **Beslutninger** — han eier strategi, du eier implementasjon

---

## 15. Status quo

**Hva som kjører nå (per 2026-05-14 21:00):**

- ✅ Backend: localhost:4000 (PID 10147, fresh fra dev:nuke 19:20)
- ✅ Admin-web: localhost:5174
- ✅ Game-client: localhost:5173
- ✅ Postgres: spillorama@localhost:5432 (clean — alle stale runder cancelled)
- ✅ Redis: localhost:6379 (FLUSHALL kjørt)
- ✅ db-perf-watcher (launchd, hver 5 min)
- ✅ wallet-integrity-watcher (launchd, hver 60 min)

**Backend-state:**
- 3 GoH-rooms aktive (BINGO_DEMO-DEFAULT-GOH, BINGO_DEMO-GOH, BINGO_DEMO-PILOT-GOH)
- 45 wallets seedet
- 5 spillkataloger
- 6 halls
- 0 aktive Spill 1 scheduled-games (clean state for testing)

**Åpne PR-er:**
- #1467 (synthetic-bot accessToken-fix) — auto-merge ENABLED, venter CI
- #1425 — MERGET (Frontend State Dump)
- #1360 — auto-merge satt, mergeable=UNKNOWN-quirk

---

## 16. Avslutting

Ny PM — du arver et solid fundament. Evolution-grade DB-observability er på plass. R1-R12 pilot-gating er 95% komplett. ADR-katalogen er sunn (23 ADR-er, alle Accepted eller Superseded med ny ADR).

**Din ENE jobb er:** Løse Next Game Display-bug 100% slik at master-konsollet **alltid** viser riktig "neste spill" i alle states.

Bruk all tid du trenger. Følg rutinene. Spawne agenter ved behov. Oppdater dokumentasjon ETTER hver sesjon. Skriv neste handoff når du logger av.

**Lykke til. Pilot venter til du er ferdig.**

---

## 17. Endringslogg

| Dato | Endring | Forfatter |
|---|---|---|
| 2026-05-14 | Initial — sesjons-handoff etter komplett DB-observability-leveranse. Next Game Display-bug eskalert til kritisk P0 etter Tobias-direktiv om "1-4 ukers refactor OK". | Claude Opus 4.7 (PM-AI 2026-05-14) |
