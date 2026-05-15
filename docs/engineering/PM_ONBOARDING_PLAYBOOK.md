# PM-onboarding-playbook — Spillorama-system

**Status:** Autoritativ. Følg denne rutinen ved hver PM-overgang.
**Sist oppdatert:** 2026-05-14
**Eier:** Tobias Haugen (teknisk lead)
**Vedlikehold:** Oppdater ved hver større endring i prosjekt-fundamentet (ny ADR som overstyrer mønstre, nye pilot-haller, store kataloog-endringer).

> **Til ny PM:** Følg denne playbook fra topp til bunn. Estimert tid 60-90
> minutter for full onboarding (lengre hvis du er helt ny til prosjektet —
> da må du også lese ALLE PM-handoffs siden 2026-04-23, se §3 trinn 3).
> Etter dette skal du ha 100% kunnskaps-paritet med forrige PM og være
> klar til å fortsette uten kontekst-tap.
>
> **🚨 LESE-DISIPLIN ER IKKE VALGFRITT.** Tobias-direktiv 2026-05-10:
>
> > "Det er ekstremt viktig at vi setter den rutinen slik at man alltid leser ALL dokumentasjon — slik at man har all kontekst og ikke går i de samme fallgruvene som tidligere."
>
> Hvis du hopper over noen av de obligatoriske doc-ene (særlig §2
> Tobias-direktiver, §6 compliance, §3-trinn-3 alle handoffs, §3.1
> tema-spesifikke audits), garanterer du at du gjentar fallgruver som
> tidligere PM-er har dokumentert og løst. Det er ikke akseptabelt.
>
> Hopp ALDRI over §2 (immutable direktiver), §3 trinn 2-3.1 (lesing),
> §6 (compliance og regulatorisk), eller §10 (sjekkpunkter for
> fullført onboarding).
>
> **⛔ HARD-BLOCK (vanntett gate 2026-05-10):** Før første kode-handling MÅ du passere onboarding-gate via `bash scripts/pm-checkpoint.sh`. Se §3 Trinn 0. Hvis du hopper over denne, har du brutt et eksplisitt Tobias-direktiv 2026-05-10 og PR-template-en din kommer til å bli rød.

---

## Innhold

1. [30-sekund-pitch og kontekst](#1-30-sekund-pitch-og-kontekst)
2. [Tobias' fundamentale direktiver (immutable)](#2-tobias-fundamentale-direktiver-immutable)
3. [Trinn-for-trinn onboarding-rutine](#3-trinn-for-trinn-onboarding-rutine)
4. [Lese-først-prioritert med tidsestimater](#4-lese-først-prioritert-med-tidsestimater)
5. [Kommunikasjons-mønstre med Tobias](#5-kommunikasjons-mønstre-med-tobias)
6. [Compliance og regulatorisk (Lotteritilsynet)](#6-compliance-og-regulatorisk-lotteritilsynet)
7. [Pilot-status og runbooks (R1-R12)](#7-pilot-status-og-runbooks-r1-r12)
8. [Tekniske prosedyrer (PR, deploy, rollback)](#8-tekniske-prosedyrer-pr-deploy-rollback)
9. [Anti-mønstre og fallgruver](#9-anti-mønstre-og-fallgruver)
10. [Sjekkpunkter for fullført onboarding](#10-sjekkpunkter-for-fullført-onboarding)
11. [Vedlikehold av playbook](#11-vedlikehold-av-playbook)

---

## 1. 30-sekund-pitch og kontekst

**Spillorama** er en norsk live-bingo-plattform regulert under pengespillforskriften. Mål: **casino-grade kvalitet på linje med Evolution Gaming og Playtech Bingo**.

| Område | Status |
|---|---|
| **Pilot-skala (Q3 2026 første runde)** | 4 haller (Teknobingo Årnes som master + Bodø + Brumunddal + Fauske) |
| **Skalerings-mål** | 24 haller × 1500 spillere = 36 000 samtidige |
| **Spill (live på prod)** | Spill 1 (`bingo`), Spill 2 (`rocket`), Spill 3 (`monsterbingo`), SpinnGo (`spillorama` / Spill 4 markedsføring), Candy (ekstern iframe) |
| **Tech-stack** | Node 22 + Express + Socket.IO + Postgres 16 + Redis 7 + Pixi.js + TypeScript strict |
| **Deploy** | Render.com Frankfurt, Blue-Green, auto-deploy fra `main` |
| **Repo** | [tobias363/Spillorama-system](https://github.com/tobias363/Spillorama-system) |
| **Prod** | https://spillorama-system.onrender.com/ |
| **Linear** | https://linear.app/bingosystem (BIN-NNN-issues) |

**Tre-tier-arkitektur:**
```
Spillere (web/iOS/Android) → Pixi.js game-client (packages/game-client)
                              ↓ Socket.IO + HTTPS
                            → Backend (apps/backend)
                              ↓ TLS
                            → Postgres 16 + Redis 7
Hall-operatører/agenter    → Admin-web (apps/admin-web) + Agent-portal
                              ↓ HTTPS
                            → Backend
Candy (tredjeparts)        ↔ Wallet-bro (/api/ext-wallet/*) + iframe
```

**Server er sannhets-kilde.** Klient er view. Alt regulatorisk valideres backend-side.

---

## 2. Tobias' fundamentale direktiver (immutable)

Disse er gjennomdiskutert med Tobias og er **IMMUTABLE inntil han eksplisitt sier annet**. Hvis du fraviker disse uten godkjennelse, har du brutt fundamental kontrakt.

### 2.1 Quality > speed (vedtatt 2026-05-05)
> "Ingen deadline, kvalitet over hastighet. All død kode skal fjernes."

Hvis du står foran valget "ship buggy nå" eller "fiks det riktig som tar 2 dager til", velg fiksen. Død kode kommenteres aldri ut — den slettes.

### 2.2 Tobias rør ALDRI git lokalt
PM eier `git pull` i hovedrepoet etter HVER PR-merge. Hot-reload tar resten — Tobias bare refresher nettleseren.

**Standard restart-kommando etter merge** (vedtatt 2026-05-11, gi denne til Tobias):
```bash
cd /Users/tobiashaugen/Projects/Spillorama-system && npm run dev:nuke
```

**ALLTID** med `cd /Users/...` først — Tobias er ofte i `~` etter ny terminal-tab.

`dev:nuke` dreper ALLE stale prosesser (port 4000-5175 + Docker), FLUSHALL Redis, canceler stale runder i Postgres, re-seeder via `--reset-state`, og starter ren stack (backend + admin-web + game-client + visual-harness) i ÉN kommando. Garantert clean state — ingen selective restart hvor en av lagene kan henge i stale state.

> **Gammel selective-kommando** (`lsof -nP -iTCP:5174 ... && npm --prefix apps/admin-web run dev`) er superseded. Bruk IKKE denne lenger — den restarter kun admin-web og lar backend/game-client/Docker være urørt, som gir falsk trygghet hvis merge inkluderer endringer på andre lag.

### 2.3 PM verifiser CI etter PR-åpning
Auto-merge fyrer KUN ved ekte CI-grønning, ikke ved INFRA-fail. Etter ny PR + auto-merge: sjekk `gh pr checks <nr>` etter 5-10 min. Hvis ≥ 3 PR-er feiler samme måte → INFRA-bug → root-cause-fix først.

### 2.4 Doc-en vinner over kode
Hvis kanonisk doc motsier kode, **doc-en er sannheten**. Koden må fikses.

Kanoniske docs (per topic):
- Spill-regler: [SPILL_REGLER_OG_PAYOUT.md](../architecture/SPILL_REGLER_OG_PAYOUT.md)
- Spill-katalog: [SPILLKATALOG.md](../architecture/SPILLKATALOG.md)
- Spill 1-3 fundament: [SPILL1/2/3_IMPLEMENTATION_STATUS_2026-05-08.md](../architecture/)
- Robusthet-mandat: [LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08.md](../architecture/LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08.md)

### 2.5 Spill 1, 2, 3 har FUNDAMENTALT forskjellige arkitekturer

> **🚨 Full sammenligningstabell ligger i [`docs/architecture/SPILL_ARCHITECTURE_OVERVIEW.md`](../architecture/SPILL_ARCHITECTURE_OVERVIEW.md).**
>
> Den dekker alle aspekter (grid, ball-range, rom-modell, master-rolle, spilleplan, auto-restart, vinning, bonus, compliance, premie-modus, salgskanaler m.fl.). IKKE dupliser tabellen her — pek til den.

**Korte hovedforskjeller:**
- **Spill 1** (`bingo`) — per-hall lobby + GoH-master + plan-runtime, master-styrt mellom runder
- **Spill 2** (`rocket`) — ETT globalt rom, perpetual loop, auto-start på threshold
- **Spill 3** (`monsterbingo`) — ETT globalt rom, sequential phase-state-machine (Rad 1 → 3s pause → Rad 2 → ...)

**Antakelser fra ett spill overføres IKKE til de andre.** For dyp implementasjon per spill, se `SPILL[1-3]_IMPLEMENTATION_STATUS_2026-05-08.md`.

### 2.6 Spillkatalog (vedtatt 2026-04-25 etter korrigering)

| Markedsføring | Slug | Kategori | §11-prosent |
|---|---|---|---|
| Spill 1 | `bingo` | MAIN_GAME (Hovedspill) | 15% |
| Spill 2 | `rocket` | MAIN_GAME | 15% |
| Spill 3 | `monsterbingo` | MAIN_GAME | 15% |
| **Spill 4 / SpinnGo** | `spillorama` (legacy: `game5`) | **DATABINGO** | **30% + 2500 kr cap** |
| Candy | `candy` | Tredjeparts iframe | (ikke vårt regulatoriske ansvar) |

**Game 4 / `themebingo` er deprecated (BIN-496). Ikke bruk.**

### 2.7 PM-sentralisert git-flyt (ADR-0009, 2026-04-21)
- **Agenter:** commit + push feature-branch — **ALDRI** opprett PR eller merge
- **PM (deg):** `gh pr create` + `gh pr merge --squash --auto --delete-branch`
- **Tobias:** rør aldri git lokalt

### 2.8 Done-policy (ADR-0010, 2026-04-17)
Issue lukkes **kun** når:
1. Commit MERGET til `main` (SHA dokumentert)
2. `file:line`-bevis (eksakt path i ny struktur)
3. Test eller grønn CI-link verifiserer atferd

### 2.9 Live-rom-robusthet (LIVE_ROOM_ROBUSTNESS_MANDATE 2026-05-08)
> "Spill 1, 2 og 3 er live rom som alltid må være live innenfor åpningstid. Hvis dette er bygd sånn at det feiler et par ganger i løpet av dagen eller på dårlig arkitektur, vil vi få mye ufornøyde kunder og tape penger."

Mål: 99.95% uptime (≤ 4 min/uke nedetid). R1-R12 er pilot-gating-tiltak (se §7).

### 2.10 4-hall-pilot først, utvidelse betinger 2-4 ukers stabilitet
Pilot-omfang er 4 haller. Utvidelse forutsetter at R4 (load-test 1000), R6 (outbox-validering), R9 (Spill 2 24t-leak-test) er bestått, og at det ikke er kjente compliance-feil.

### 2.11 Skill-loading lazy per-task
Last KUN skills når du selv skal redigere kode i det domenet. Skip for ren PM/orkestrering eller delegert agent-arbeid (vedtatt 2026-04-25).

### 2.12 Test-driven iterasjon på pilot-kode (vedtatt 2026-05-13)
Etter 3-dagers buy-flow-iterasjon uten konvergens: **manuell loop-iterasjon er forbudt**. Hvis en bug sees 2+ ganger, MÅ test skrives FØRST som reproduserer, deretter fix.

Pilot-test-infra: `npm run test:pilot-flow` (13s deterministic). Detaljer i [`PILOT_TEST_FLOW_AND_KNOWLEDGE_PROTOCOL.md`](./PILOT_TEST_FLOW_AND_KNOWLEDGE_PROTOCOL.md).

### 2.13 Disiplin-håndhevelse: knowledge-protocol-checkbox blokkerer PR (vedtatt 2026-05-13)
Hver PR som rører pilot-relatert kode MÅ ha utfylt checkbox-seksjon "Knowledge protocol" i PR-body. Håndheves av `.github/workflows/knowledge-protocol-gate.yml`.

### 2.14 Test-DB: samme som live-stack, non-destructive default (vedtatt 2026-05-13)
Pilot-test bruker SAMME Postgres-DB som Tobias' manuelle dev-stack. Tester er **non-destructive by default** — `resetPilotState({destroyRooms: true})` kreves eksplisitt for fresh-baseline.

### 2.15 Ingen hard deadline — kvalitet > tid (vedtatt 2026-05-13)
Pilot lanseres NÅR alle kvalitets-kriteriene er oppfylt, ikke etter en kalender.

### 2.16 Plan C: én måned ekstra OK ved strukturelle bugs (vedtatt 2026-05-13)
Hvis BUG_CATALOG viser ≥ 3 strukturelle bugs i pilot-kode, godkjent å bruke inntil 1 måned ekstra på arkitektur-rewrite.

### 2.17 Parallelle agenter: grønt lys uten å spørre (vedtatt 2026-05-13)
PM-AI kan spawne så mange parallelle agenter som hensiktsmessig. Krav: klart scope, ingen fil-kollisjon, AGENT_EXECUTION_LOG oppdateres per leveranse. **Bruk `isolation: "worktree"` ved ≥ 2 parallelle agenter på samme repo for å unngå file-revert-konflikter.**

### 2.18 Live-monitor ALLTID aktiv ved testing (vedtatt 2026-05-13, IMMUTABLE)

> "Denne må alltid være aktiv når vi tester og alltid lage rapporter over hva som skjer. Det er den eneste måten vi kan få fremgang på."
> — Tobias 2026-05-13

**HARD REGEL:** Når PM eller Tobias starter en test-sesjon, MÅ live-monitor-agent være aktiv som FØRSTE handling i sesjonen.

#### Aktiv push: monitor + push-daemon (2026-05-13)

Den passive monitor-only-flyten (kun skriver til `/tmp/pilot-monitor.log`)
er supplert med en **aktiv push-mekanisme** som leverer P0/P1-anomalier
direkte til PM-sesjonen:

```bash
# Start begge prosesser med ett kall:
bash scripts/start-monitor-with-push.sh

# I annen terminal — PM-sesjon tail-er urgent-FIFO for kun P0/P1:
tail -f /tmp/pilot-monitor-urgent.fifo
```

**Produserer:**
- `/tmp/pilot-monitor.log` — full log (alle severities, append-only)
- `/tmp/pilot-monitor-snapshot.md` — 60s-snapshot
- `/tmp/pilot-monitor-round-<N>.md` — per-runde-rapport
- `/tmp/pilot-monitor-urgent.fifo` — named pipe — KUN P0/P1
- `/tmp/pilot-monitor.pid` + `/tmp/pilot-monitor-push.pid` — for clean shutdown
- **macOS notification** ved P0 (sound: Sosumi) eller P1 (sound: Submarine)
- **Terminal bell** (`\a`) for hver P0/P1

**Severity-klassifisering:**

| Severity | Eksempel | Push? | Sound |
|---|---|---|---|
| **P0** | Live-room down, wallet-mismatch, compliance-violation, backend down 30s | ✅ | Sosumi |
| **P1** | Stuck draw, stale snapshot 60s, DB-mismatch, repeated error | ✅ | Submarine |
| **P2** | Monitor-internal, recoverable | ❌ | (kun log) |
| **P3** | Round-end, status-change, info | ❌ | (kun log) |

Full klassifisering: [`docs/engineering/MONITOR_SEVERITY_CLASSIFICATION.md`](./MONITOR_SEVERITY_CLASSIFICATION.md).

#### Legacy: spawn live-monitor-agent (fortsatt gyldig som fallback)

Hvis du foretrekker å spawn en agent som bruker monitoren via tool-call,
er denne mal-en fortsatt gyldig. Agenten kan parallellt skrive til
`/tmp/pilot-monitor-init.md` og lese fra log-en:

```typescript
Agent({
  description: "Live monitor pilot-flow events",
  subagent_type: "general-purpose",
  run_in_background: true,
  prompt: `<<autonomous-loop>>

Du er live-monitor for pilot-flow debugging.

Loop hvert 5 sek:
1. curl "http://localhost:4000/api/_dev/debug/events/tail?token=spillorama-2026-test&sinceId=<lastId>"
2. Parse JSON, detect anomalier
3. Tail backend stdout hvis tilgjengelig
4. Skriv log: /tmp/pilot-monitor.log (kontinuerlig)
5. Skriv snapshot: /tmp/pilot-monitor-snapshot.md (hver 60s)
6. Skriv initial-rapport: /tmp/pilot-monitor-init.md (etter første poll)

Anomali-klasser:
- screen.mount=play men ingen popup.show innen 5s
- socket.recv room:update men klient ikke i play-screen
- wallet.error / buy.error
- Backend-stdout ERROR/FATAL/TypeError
- GameStatus stuck > 60s uten endring
- ROOM_LOCKED-errors på room:join under aktiv runde

Token: $RESET_TEST_PLAYERS_TOKEN i apps/backend/.env (default spillorama-2026-test).
ScheduleWakeup hver 60s.
Stopp KUN når PM ber eksplisitt, eller backend dødt > 5 min.`,
})
```

**ALDRI stopp monitoren med rasjonale "test-infra er bedre"** — Tobias-direktiv 2026-05-13. Monitor + test-infra er komplementære.

**PM sesjons-start sjekkliste (oppdatert 2026-05-13):**
1. Verifiser dev:nuke kjører (`curl localhost:4000/health`)
2. **Start monitor + push-daemon:** `bash scripts/start-monitor-with-push.sh` (i background eller eget terminal)
3. I PM-sesjons-terminal: `tail -f /tmp/pilot-monitor-urgent.fifo` for å se P0/P1 i sanntid
4. Verifiser at FIFO + PID-filer finnes: `ls -la /tmp/pilot-monitor*`
5. Klart for testing

**Test push-flyten:**
```bash
bash scripts/__tests__/monitor-severity-classification.test.sh
```

### 2.19 Skill-doc-protokoll ALLTID i fix-agent-prompts (vedtatt 2026-05-14, IMMUTABLE)

> "Vi har nå breifet agenter om at full dokumentasjon om arbeidet er viktig, slik at skillsene blir oppdatert med hva som nå funker og ikke slik at endrigner som gjør fremover da ikke endrer på en tidligere fiks? ... Kan du alltid legge det i rutinen til PM? det er ekstremt viktig for god progresjon og at vi kke går 2 skritt frem og 1 tilbake"
> — Tobias 2026-05-14

**HARD REGEL:** Hver fix-agent-prompt PM sender MÅ inneholde "Dokumentasjons-protokoll"-seksjon som krever at agenten oppdaterer disse i SAMME PR som koden:

1. **Relevant skill** under `.claude/skills/<skill-name>/SKILL.md` — ny seksjon eller utvidet eksisterende
2. **`docs/engineering/PITFALLS_LOG.md`** — ny entry i riktig § (1.x compliance, 2.x wallet, 3.x spill-arkitektur, 4.x live-rom, 5.x git, 6.x test, 7.x frontend, 8.x doc-disiplin, 11.x agent-orkestrering)
3. **`docs/engineering/AGENT_EXECUTION_LOG.md`** — kronologisk entry med "Lessons learned"

**Hvorfor:** Uten dette går vi "2 skritt frem og 1 tilbake". Fremtidige agenter overskriver tidligere fixer fordi de ikke vet hva som er bevisst valgt. Skill = forsvar mot regresjon.

**Reusable template:** Se [`docs/engineering/SKILL_DOC_PROTOCOL_TEMPLATE.md`](./SKILL_DOC_PROTOCOL_TEMPLATE.md). PM kopier-paster + tilpasser per task (identifiserer hvilken skill + PITFALLS-§ er relevant).

**Verifikasjon ved PR-review:** PM SKAL sjekke at PR-en inneholder:
- [ ] Skill-fil endret (eller eksplisitt begrunnelse for hvorfor ikke relevant)
- [ ] PITFALLS_LOG endret
- [ ] AGENT_EXECUTION_LOG endret

Hvis PR mangler dette → enten reject med kommentar, eller follow-up commit fra PM på samme branch FØR merge. Aldri merge en fix-PR uten doc-update — det er hovedmekanismen mot regresjon.

**Unntak:** Ren config-pin (eks. atlas-version), CI-tweak, eller ren rename. Hvis i tvil — inkluder doc-update uansett.

#### 2.19.1 Agent Task Contract foer high-risk implementation-agent (vedtatt 2026-05-15, IMMUTABLE)

**HARD REGEL:** PM skal ikke spawne high-risk implementation-agent fra fritekst eller hukommelse. Bruk fact-bound agent-kontrakt:

```bash
npm run agent:contract -- \
  --agent "Agent A — <scope>" \
  --objective "<konkret, evidence-bundet maal>" \
  --files <path1> \
  --files <path2> \
  --evidence <forensic-report-eller-audit.md> \
  --risk P0 \
  --output /tmp/agent-contract-<scope>.md
```

Lim hele output-filen inn i agent-prompten. Kontrakten inneholder automatisk:
- main-SHA og PM-branch ved spawn
- fil-scope og write-boundary
- evidence pack som agenten maa sitere
- relevante skills via `scripts/find-skills-for-file.mjs`
- context-pack via `scripts/generate-context-pack.sh`
- hard constraints, non-goals, skill-doc-protokoll og delivery-report krav

**Hvorfor:** Agent-misforstaaelser oppstaar naar prompten blander fakta, hypoteser og uformell chat. Kontrakten tvinger agenten til aa skille bevist root cause fra hypotese, og stopper agenten hvis evidence motsier objective.

**Paakrevd for:** Spill 1/2/3 runtime, wallet, compliance, live-room, master-flow, repeated live-test bugs, og parallelle agent-boelger.

### 2.20 Sentry + PostHog overvåking ALLTID aktiv ved testing (vedtatt 2026-05-14, IMMUTABLE)

> "Kan du legge inn i PM rutningen at de skal alltid overvåke sentry/posthog slik at feil blir tatt hånd om med en gang?"
> — Tobias 2026-05-14

**HARD REGEL:** Når PM eller Tobias starter en test-sesjon, MÅ Sentry- og PostHog-MCP brukes aktivt for å fange feil i sanntid. Ikke vente på at Tobias rapporterer bug i chat — fange dem fra observability-stacken først.

#### Sentry MCP (org=spillorama, region=de.sentry.io)

PM skal:
1. **Sjekke Sentry ved sesjons-start** — `mcp__15c870cf-...__search_issues(query="is:unresolved firstSeen:-1h")` viser nye issues fra forrige time.
2. **Periodisk poll under test-sesjon** — minimum hvert 10. min, kombinert med live-monitor-fifo. Bruk `ScheduleWakeup` med `delaySeconds: 600` + prompt som re-poller Sentry.
3. **Auto-fix-trigger ved nye P0** — hvis en ny issue dukker opp under aktiv testing med `level:error` og `events > 5`, spawn fix-agent automatisk med stack-trace + auto-PR.
4. **Auto-resolve etter merge** — bruk `mcp__15c870cf-...__update_issue` med `status: "resolved"` etter PR merger. Inkluder `Fixes SPILLORAMA-XXX-N` i commit-meldingen som auto-trigger.
5. **Korrelere med Linear** — hvis en Sentry-issue krever større refaktor, lag tilsvarende `BIN-NNN` i Linear via `mcp__linear__create_issue` + link.

#### PostHog MCP

PM skal:
1. **Spille-sesjons-analyse** — etter pilot-test, hent `error-tracking-issues-list` + `session-recording-list` for å se hva spillere faktisk gjorde.
2. **Funnel-drop-detect** — hvis ny PR endrer ticket-purchase-flyt, hent `insight-query` mot funnel-data for å se om drop-off endret seg signifikant.
3. **Replay-mining ved bug-rapport** — hvis Tobias rapporterer "noe rart i UI", bruk `session-recording-get` for å se EKSAKT hva spilleren gjorde (DOM-replay).

#### Sesjons-start sjekkliste (utvidet)

1. Verifiser dev:nuke kjører (curl /health)
2. Spawn live-monitor-agent ← OBLIGATORISK
3. **Sentry-baseline:** `search_issues(query="is:unresolved", sort="freq")` → kjent baseline før test starter
4. **PostHog-baseline:** `error-tracking-issues-list` → samme baseline
5. Verifiser `/tmp/pilot-monitor-init.md` skrives innen 30s
6. Klart for testing

**Etter sesjons-slutt:** Sjekk om ANY ny Sentry-issue ble registrert. Hvis ja: ikke avslutt sesjon før den er enten fixet eller dokumentert som "kjent ikke-blokker" i PITFALLS_LOG.

### 2.21 Database call-overvåking ved testing (vedtatt 2026-05-14)

> "Er det noe vi kan gjøre database messign så man også får full oversikt over alle kall som blir gjort her når det testes?"
> — Tobias 2026-05-14

Fire lag av DB-overvåking nå tilgjengelig — bruk dem i kombinasjon:

#### Lag 1: PgHero dashboard (kontinuerlig, aggregert)
`http://localhost:8080` etter `npm run dev:nuke -- --observability`. Top-N slow queries, missing indexes, table bloat, long-running queries. **Bruk:** "hva er sakte i dag?" på 5-sek-skala.

#### Lag 2: pg_stat_statements (kontinuerlig, persistent)
SQL-spørring direkte mot DB for query-statistikk:
```sql
SELECT query, calls, total_exec_time, mean_exec_time, rows
FROM pg_stat_statements
ORDER BY total_exec_time DESC LIMIT 20;
```
**Bruk:** "hvilke queries har brukt mest tid totalt?" — fanger N+1-mønstre.

#### Lag 3: Slow-query-log (kontinuerlig, real-time)
`log_min_duration_statement = 100` (>100ms logges til stderr):
```bash
docker logs -f spillorama-system-postgres-1 | grep "duration:"
```
**Bruk:** Live stream av sakte queries mens du tester. Hver query > 100ms får full SQL + duration.

#### Lag 4: Sentry DB-tracing (per-request, forensics)
Hver HTTP-request får full span-tree med alle DB-spans. Inkluderer N+1-deteksjon (issue `performance_n_plus_one_db_queries`). **Bruk:** "hvor mange DB-calls per request?" — Sentry-MCP `search_issues` med `issueCategory:db_query`.

#### Aktivering for FULL query-stream (midlertidig under aktiv debug-sesjon)

Hvis du trenger å se HVER query (også < 100ms), sett midlertidig:
```sql
ALTER SYSTEM SET log_min_duration_statement = 0;
SELECT pg_reload_conf();
```
Dette logger ALT — kan fylle disk. Reset til 100 etter sesjon:
```sql
ALTER SYSTEM SET log_min_duration_statement = 100;
SELECT pg_reload_conf();
```

#### Postgres MCP (ikke aktiv per 2026-05-14)

Cowork MCP-registry har IKKE en standard Postgres-MCP. Custom-setup krever stdio-based MCP-server:
```bash
# Tobias kan installere lokalt:
npm install -g @modelcontextprotocol/server-postgres
# Cowork → Connectors → Add custom MCP → command:
npx @modelcontextprotocol/server-postgres "postgres://spillorama:spillorama@localhost:5432/spillorama"
```
Ved aktivert: PM-AI kan kjøre vilkårlige SELECT-queries direkte. Foreløpig brukes Bash+psql som ad-hoc fallback.

**Anbefalt prosedyre under test-sesjon:**
- Aktivér PgHero (Lag 1) + slow-log (Lag 3) ved sesjons-start
- Sentry-DB-tracing (Lag 4) er alltid på
- Ved mistanke om N+1 eller treg query: skum PgHero "Queries"-tab + Sentry `performance_n_plus_one_db_queries`-issues
- Ved kompleks reproduksjon: aktivér Lag 4-full-trace midlertidig + analyser i `pg_stat_statements`

### 2.22 PM Knowledge Continuity v2 før første kodehandling (vedtatt 2026-05-15)

> "Det som også er ekstremt viktig for meg er at ny PM alltid får alt av informasjon som trengs for at han kan fortsette på arbeidet til forgående PM uten spørsmål til hva som har blitt gjort."
> — Tobias 2026-05-15

**HARD REGEL:** Dokumenter som finnes i repo er ikke alene bevis på kunnskapsparitet. Ny PM må generere current-state evidence pack og skrive en konkret self-test før første kodehandling.

Kjør:

```bash
node scripts/pm-knowledge-continuity.mjs --generate-pack \
  --output /tmp/pm-knowledge-continuity-pack.md
node scripts/pm-knowledge-continuity.mjs --self-test-template \
  --pack /tmp/pm-knowledge-continuity-pack.md \
  --output /tmp/pm-knowledge-self-test.md
$EDITOR /tmp/pm-knowledge-self-test.md
node scripts/pm-knowledge-continuity.mjs --confirm-self-test \
  /tmp/pm-knowledge-self-test.md \
  --pack /tmp/pm-knowledge-continuity-pack.md
node scripts/pm-knowledge-continuity.mjs --validate
```

Self-testen må bevise:
- Hva forrige PM leverte og hva som står igjen.
- Hvilke åpne PR-er/workflows/git-endringer som må håndteres.
- Hvilke P0/P1-risikoer, invariants, skills og PITFALLS som gjelder før neste arbeid.
- Hvilken første handling PM tar og hvorfor den fortsetter i samme spor.

**Agent-overlevering:** Alle implementer-/fix-agenter skal levere `Agent Delivery Report` før PM åpner PR. Bruk [`AGENT_DELIVERY_REPORT_TEMPLATE.md`](./AGENT_DELIVERY_REPORT_TEMPLATE.md). Rapporten må vise kontekst lest, invariants bevart, tester, skill/PITFALLS/AGENT_EXECUTION_LOG-oppdateringer og åpne risikoer.

Kanonisk prosedyre: [`docs/operations/PM_KNOWLEDGE_CONTINUITY_V2.md`](../operations/PM_KNOWLEDGE_CONTINUITY_V2.md).

---

## 3. Trinn-for-trinn onboarding-rutine

**Forventet total tid: 90-180 min for ny PM, 45-75 min ved samme-dag takeover.** Hopp ikke over noen trinn — særlig §2 og §6.

### ⛔ Trinn 0 — Vanntett onboarding-gate (HARD-BLOCK)

**Du har FORBUD mot å gå til Trinn 1+ før denne gaten er passert.**

```bash
cd /Users/tobiashaugen/Projects/Spillorama-system
bash scripts/pm-checkpoint.sh --validate    # exit 0 = passert, exit 1 = må kjøres
```

Hvis exit ≠ 0:

```bash
bash scripts/pm-checkpoint.sh
```

Den interaktive gaten:

1. Lister alle `docs/operations/PM_HANDOFF_*.md` fra prosjekt-start (2026-04-23) til i dag
2. Krever per-fil-bekreftelse (`ja` / `nei`) + 1-3 setninger fri-tekst-takeaway
3. Skriver `.pm-onboarding-confirmed.txt` til repo-rot med timestamp + main-SHA + alle takeaways
4. Filen er gyldig i 7 dager (`PM_CHECKPOINT_VALIDITY_DAYS`)

**Hvorfor hard-block?** Tobias-direktiv 2026-05-10:

> "Dette er nå lagt inn i rutinen så det er umulig for ny PM å ikke få med seg dette? Vi må gjøre dette så vanntett som mulig."

Tidligere PM-er har lest kun siste handoff og hoppet over de eldre — som har ført til repetert kontekst-tap, samme spørsmål to ganger, og fallgruver som allerede var dokumentert. Denne gaten gjør det fysisk umulig å skippe (uten å bryte direktivet eksplisitt og dokumentere hvorfor i PR-beskrivelsen).

**For ikke-PM-roller** (Tobias, agenter under PM-koordinering, eksterne utviklere): trenger ikke kjøre. PR-template har checkbox.

**Tobias-verifikasjon:** Tobias kan lese `.pm-onboarding-confirmed.txt` etter første PR for å sjekke at takeaway-tekstene er ekte og matcher faktisk handoff-innhold. Skriv ALDRI placeholder-takeaway som "lest" eller "OK" — det er fanget av kvalitets-sjekken.

### Trinn 0.5 — Doc-absorpsjon-gate + Knowledge Continuity v2 (HARD-BLOCK)

```bash
bash scripts/pm-doc-absorption-gate.sh --validate
node scripts/pm-knowledge-continuity.mjs --validate
```

Hvis `pm-doc-absorption-gate.sh --validate` feiler, kjør interaktiv gate:

```bash
bash scripts/pm-doc-absorption-gate.sh
```

Hvis `pm-knowledge-continuity.mjs --validate` feiler, generer pack + self-test:

```bash
node scripts/pm-knowledge-continuity.mjs --generate-pack \
  --output /tmp/pm-knowledge-continuity-pack.md
node scripts/pm-knowledge-continuity.mjs --self-test-template \
  --pack /tmp/pm-knowledge-continuity-pack.md \
  --output /tmp/pm-knowledge-self-test.md
$EDITOR /tmp/pm-knowledge-self-test.md
node scripts/pm-knowledge-continuity.mjs --confirm-self-test \
  /tmp/pm-knowledge-self-test.md \
  --pack /tmp/pm-knowledge-continuity-pack.md
```

PM går ikke videre før begge validerer. Hensikten er å fange forskjellen mellom "jeg har lest dokumentene" og "jeg kan fortsette arbeidet uten kontekst-tap".

### Trinn 1 — Generer live current-state (3 min)

Kjør PM-onboarding-scriptet:

```bash
cd /Users/tobiashaugen/Projects/Spillorama-system
./scripts/pm-onboarding.sh > /tmp/pm-onboarding.md
```

Les `/tmp/pm-onboarding.md`. Den gir deg:
- Forrige PM-handoff (siste 30 linjer)
- R1-R12 pilot-gating-status
- Live dev-stack-helse (backend, admin-web, Postgres, Redis)
- Spill 1/2/3 health-endpoints
- Sist 10 commits til main
- Lokale uncommitted endringer (gårsdagens arbeid)
- Åpne PR-er med CI-status
- Aktive worktrees (parallelle agenter)
- BACKLOG.md åpne saker
- Tobias-kommunikasjons-mønstre

**Hvis backend ikke kjører:** kjør `npm run dev:all` fra repo-rot. Vent 30 sek. Hvis fortsatt broken — se §8.5 ("Ren restart").

### Trinn 2 — Les MASTER_README + denne playbook (20 min)

Les disse i rekkefølge:

| # | Doc | Tid | Hvorfor |
|---|---|---|---|
| 1 | [`MASTER_README.md`](../../MASTER_README.md) | 5 min | Pitch + tech-stack + nyeste sesjons-oversikt |
| 2 | [`docs/SYSTEM_DESIGN_PRINCIPLES.md`](../SYSTEM_DESIGN_PRINCIPLES.md) | 10 min | "True north" — design-filosofi, casino-grade-mål, ikke-mål |
| 3 | **§2 i denne playbook** (Tobias' direktiver) | 5 min | Immutable kontrakter — overstyrer alt |

### Trinn 3 — Les ALLE relevante PM-handoffs (30-60 min)

> **🚨 IKKE bare les siste handoff.** Tidligere PM-er har dokumentert
> kjente fallgruver, anti-mønstre og immutable beslutninger som ikke
> nødvendigvis er repetert i nyeste handoff. Hopp over dette og du går
> garantert i fellene som har blitt løst tidligere.

**Tobias-direktiv 2026-05-10:**
> "Det er ekstremt viktig at vi setter den rutinen slik at man alltid leser ALL dokumentasjon — slik at man har all kontekst og ikke går i de samme fallgruvene som tidligere."

**Hva du MÅ lese (i kronologisk rekkefølge — eldste først):**

```bash
ls -1 /Users/tobiashaugen/Projects/Spillorama-system/docs/operations/PM_HANDOFF_*.md | sort
```

For hver handoff (alle siden 2026-04-23 hvis du er ny til prosjektet):
1. Hvilke beslutninger ble fattet — disse er ofte fortsatt aktive
2. Hvilke bugs ble oppdaget — sjekk om de er fikset eller fortsatt åpne
3. Hvilke fallgruver er dokumentert — IKKE gjenta dem
4. Hvilke direktiver fra Tobias er nye — disse er kumulative, ikke erstattende

**Minimum-lesingsregel for ny PM:**
- Hvis du er **helt ny** til prosjektet: ALLE handoffs siden 2026-04-23 (~10-15 stk, ~3-5 min hver = 30-60 min total)
- Hvis du **kjenner prosjektet** men har vært borte i 1+ måned: alle handoffs etter forrige du leste
- Hvis du **var her i går**: kun siste handoff

**Anti-mønster:** "Jeg leser bare den siste — den er state-of-the-art."

Dette er FEIL. Siste handoff dekker SISTE SESJON, ikke hele prosjektet. Anti-mønstre, regulatoriske direktiver, og fallgruver er spredt utover hele handoff-historikken og må leses kumulativt.

### Trinn 3.1 — Les ALLE relevante audits + design-doc-er (avhengig av scope)

Hvis du jobber med wallet/compliance:
- ALLE filer i `docs/compliance/` (~10-15 stk)
- ALLE wallet-relaterte audits i `docs/audit/`

Hvis du jobber med Spill 1/2/3:
- `SPILL[1-3]_IMPLEMENTATION_STATUS_2026-05-08.md` (alle 3)
- `SPILL_REGLER_OG_PAYOUT.md`
- `SPILLKATALOG.md`
- ALLE `SPILL*_AUDIT*` i `docs/architecture/`

Hvis du jobber med pilot-go-live:
- `LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08.md`
- ALLE `PILOT_*` runbooks i `docs/operations/`
- ALLE `R[2-12]_*_TEST_RESULT*` i `docs/operations/`

**Tommelfingerregel:** Søk i `docs/`-katalogen for tema du jobber med, sortert etter modifisert dato (nyeste først), les minimum siste 5 relaterte. Bedre mer enn mindre.

```bash
# Eksempel for "wallet"-tema:
find /Users/tobiashaugen/Projects/Spillorama-system/docs -name "*wallet*" -o -name "*WALLET*" | head -20
```

### Trinn 3.2 — Les PITFALLS_LOG + AGENT_EXECUTION_LOG (15-20 min)

> **🚨 KRITISK:** Tobias-direktiv 2026-05-10:
> > "Når agenter jobber og du verifiserer arbeidet deres er det ekstremt viktig at alt blir dokumentert og at fallgruver blir forklart slik at man ikke går i de samme fellene fremover. Det er virkelig det som vil være forskjellen på om vi får et fungerende system eller er alltid bakpå og krangler med gammel kode/funksjoner."

Spillorama har 100+ dokumenterte fallgruver akkumulert siden 2026-04. Hvis du ikke kjenner disse fra dag 0, gjentar du dem. Det er ikke akseptabelt.

**Obligatoriske docs:**

1. **[`PITFALLS_LOG.md`](./PITFALLS_LOG.md)** — sentral fallgruve-katalog (100+ entries i 12 kategorier).
   - Skim hele dokumentet (~10 min)
   - For ditt scope: les relevante §-er nøye (~5-10 min):
     - **Compliance/wallet-arbeid:** §1 + §2 + §8.4 (kode vs doc)
     - **Spill 1/2/3-arkitektur:** §3 (FUNDAMENTAL forskjell mellom spillene) + §4
     - **Pilot-go-live:** §3 + §4 + §6 (test-infra)
     - **Git/PR-workflow:** §5 + §11 (agent-orkestrering)
     - **Frontend/game-client:** §7 + §10 (routing)

2. **[`AGENT_EXECUTION_LOG.md`](./AGENT_EXECUTION_LOG.md)** — kronologisk agent-arbeid med learnings (~5 min skim).
   - Sjekk "Aktive agenter"-tabell — hvilke agenter kjører nå?
   - Sjekk "Mønstre observert" for hva som funker / ikke funker
   - Hvis du planlegger ny agent på samme scope som tidligere: les den entry-en

**Når du spawner agent:**
- Inkluder relevante PITFALLS_LOG §-pekere i agent-prompt
- Eksempel: "Les `PITFALLS_LOG.md` §2 (Wallet) før du rør wallet-kode"
- Etter agent-leveranse: legg til ny entry i AGENT_EXECUTION_LOG + eventuelle nye fallgruver i PITFALLS_LOG

### Trinn 4 — Spawn 6 parallelle research-agenter (10 min ventetid)

Hvis du er en AI-PM med agent-tilgang og dette er **første** onboarding (ikke gjentakelse), spawn disse 6 Explore-agentene parallelt for kunnskaps-deep-dive:

| Agent | Fokus | Resultat |
|---|---|---|
| A | Skills full-text deep-dive | Invariants + fallgruver per kritisk skill |
| B | PM-handoff-historikk 2026-04-23 → siste | Kronologi + utviklings-mønstre |
| C | Pilot-test-status (R2/R3/R9/R10) | Pilot-readiness, åpne risikoer |
| D | Compliance + Audit (regulatorisk) | §§ + audit-historikk + fallgruver |
| E | Engineering workflow + ADR-prosess | PR-flyt, branch-naming, ADR-katalog |
| F | Architecture deep-dive (modules, EVENT_PROTOCOL, WIRE_CONTRACT) | Modul-kart, socket-events, wire-format |

**Mal-prompts ligger i [PM_ONBOARDING_AGENT_PROMPTS.md](./PM_ONBOARDING_AGENT_PROMPTS.md)** (lag denne ved første onboarding hvis ikke eksisterer).

### Trinn 5 — Verifiser dev-stack og sjekk uncommitted state (5 min)

> **Alle kommandoer under forutsetter $REPO_ROOT.** Hvis du står i `~`,
> prefiks med `cd /Users/tobiashaugen/Projects/Spillorama-system && `.

```bash
# Sjekk backend
curl -s http://localhost:4000/health | head -c 200

# Sjekk admin-web
lsof -nP -iTCP:5174 -sTCP:LISTEN | head

# Sjekk Spill-health-endpoints
for slug in spill1 spill2 spill3; do
  echo "=== $slug ==="
  curl -s "http://localhost:4000/api/games/$slug/health?hallId=demo-hall-001" | head -c 300
  echo
done

# Sjekk uncommitted endringer (forrige PM eller Tobias)
cd /Users/tobiashaugen/Projects/Spillorama-system
git status
git diff --stat | head -20
```

Hvis det er uncommitted endringer fra forrige sesjon, sjekk forrige PM-handoff for kontekst (typisk §3 + §10 i handoff).

### Trinn 6 — Les pilot-flyt-checklist + master-flow-doc (15 min)

| Doc | Tid | Hvorfor |
|---|---|---|
| [`docs/operations/PILOT_FLOW_TEST_CHECKLIST_2026-05-08.md`](../operations/PILOT_FLOW_TEST_CHECKLIST_2026-05-08.md) | 10 min | Manuell E2E-flyt: admin → ready → master → kunde → pot-deling |
| [`docs/architecture/SPILL1_IMPLEMENTATION_STATUS_2026-05-08.md`](../architecture/SPILL1_IMPLEMENTATION_STATUS_2026-05-08.md) | 5 min (skim) | Master-flyt-fundament; aggregator + master-action-service |

### Trinn 7 — Bekreft kunnskaps-paritet til Tobias (5 min)

Send Tobias en kort melding med:

1. **Bekreftelse** du har lest playbook + forrige handoff
2. **Spørsmål** om uklarheter eller konflikter mellom kilder
3. **Plan** for neste handlinger
4. **Hva du venter på** (grønt lys for konkret oppgave?)

**Mal:**
```
Bekreftet: lest PM_ONBOARDING_PLAYBOOK + PM_HANDOFF_<dato> + §2 immutable.

State-sjekk:
- Branch: <branch>
- Backend: ✅/🚫 (port 4000/4001)
- Uncommitted: <antall filer>
- Sist commit på main: <SHA>

Spørsmål (svar kort):
1. <spørsmål>
2. <spørsmål>

Plan:
1. <neste handling>
2. <neste handling>

Klar når du er.
```

---

## 4. Lese-først-prioritert med tidsestimater

Hvis du vil dykke dypere etter trinn-rutinen i §3, her er prioritert lese-rekkefølge:

### Tier 1 — MÅ LESES (kritisk for ikke å bryte fundament)

| # | Doc | Tid | Når |
|---|---|---|---|
| 1 | [SPILL_REGLER_OG_PAYOUT.md](../architecture/SPILL_REGLER_OG_PAYOUT.md) | 20 min | FØR enhver payout-relatert endring |
| 2 | [SPILLKATALOG.md](../architecture/SPILLKATALOG.md) | 10 min | FØR enhver slug/kategori-endring |
| 3 | [LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08.md](../architecture/LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08.md) | 15 min | FØR enhver rom-arkitektur-endring |
| 4 | [SPILL1_IMPLEMENTATION_STATUS_2026-05-08.md](../architecture/SPILL1_IMPLEMENTATION_STATUS_2026-05-08.md) | 30 min | Hvis du jobber med Spill 1 |
| 5 | [SPILL2_IMPLEMENTATION_STATUS_2026-05-08.md](../architecture/SPILL2_IMPLEMENTATION_STATUS_2026-05-08.md) | 25 min | Hvis du jobber med Spill 2 |
| 6 | [SPILL3_IMPLEMENTATION_STATUS_2026-05-08.md](../architecture/SPILL3_IMPLEMENTATION_STATUS_2026-05-08.md) | 25 min | Hvis du jobber med Spill 3 |

### Tier 2 — PROSESS OG KONVENSJONER

| # | Doc | Tid | Når |
|---|---|---|---|
| 7 | [docs/engineering/ENGINEERING_WORKFLOW.md](./ENGINEERING_WORKFLOW.md) | 15 min | Før første PR |
| 8 | [docs/SESSION_HANDOFF_PROTOCOL.md](../SESSION_HANDOFF_PROTOCOL.md) | 10 min | Før første sesjons-slutt |
| 9 | [docs/adr/README.md](../adr/README.md) + ADR 0009 (PM-flyt) + 0010 (Done-policy) | 15 min | Før første merge |
| 10 | [BACKLOG.md](../../BACKLOG.md) | 10 min | For strategisk oversikt |

### Tier 3 — REGULATORISK (hvis du rør compliance)

| # | Doc | Tid |
|---|---|---|
| 11 | [docs/compliance/SPILL1_GAMETYPE_INVESTIGATION_2026-04-25.md](../compliance/SPILL1_GAMETYPE_INVESTIGATION_2026-04-25.md) | 15 min |
| 12 | [docs/operations/COMPLIANCE_INCIDENT_PROCEDURE.md](../operations/COMPLIANCE_INCIDENT_PROCEDURE.md) | 30 min |
| 13 | [docs/operations/WALLET_RECONCILIATION_RUNBOOK.md](../operations/WALLET_RECONCILIATION_RUNBOOK.md) | 20 min |
| 14 | [docs/operations/PAYOUT_REPORTING_AUDIT_2026-04-25.md](../operations/PAYOUT_REPORTING_AUDIT_2026-04-25.md) | 30 min |
| 15 | [docs/compliance/KRITISK1_RNG_ALGORITMEBESKRIVELSE.md](../compliance/KRITISK1_RNG_ALGORITMEBESKRIVELSE.md) | 15 min |

### Tier 4 — PILOT-OPERASJON (når pilot nærmer seg)

| # | Doc | Tid |
|---|---|---|
| 16 | [docs/operations/PILOT_GO_LIVE_RUNBOOK_2026-Q3.md](../operations/PILOT_GO_LIVE_RUNBOOK_2026-Q3.md) | 30 min |
| 17 | [docs/operations/PILOT_CUTOVER_RUNBOOK.md](../operations/PILOT_CUTOVER_RUNBOOK.md) | 20 min |
| 18 | [docs/operations/HALL_PILOT_RUNBOOK.md](../operations/HALL_PILOT_RUNBOOK.md) | 30 min |
| 19 | [docs/operations/INCIDENT_RESPONSE_PLAN.md](../operations/INCIDENT_RESPONSE_PLAN.md) | 30 min |
| 20 | [docs/operations/LIVE_ROOM_DR_RUNBOOK.md](../operations/LIVE_ROOM_DR_RUNBOOK.md) | 25 min |

### Tier 5 — DEEP-DIVE (referanse / når du må)

| # | Doc | Tid |
|---|---|---|
| 21 | [docs/architecture/EVENT_PROTOCOL.md](../architecture/EVENT_PROTOCOL.md) | 20 min |
| 22 | [docs/architecture/WIRE_CONTRACT.md](../architecture/WIRE_CONTRACT.md) | 15 min |
| 23 | [docs/architecture/MODULES.md](../architecture/MODULES.md) | 20 min |
| 24 | [docs/architecture/CASINO_GRADE_ARCHITECTURE_RESEARCH_2026-04-28.md](../architecture/CASINO_GRADE_ARCHITECTURE_RESEARCH_2026-04-28.md) | 30 min |
| 25 | [docs/architecture/PLAN_SPILL_KOBLING_FUNDAMENT_AUDIT_2026-05-08.md](../architecture/PLAN_SPILL_KOBLING_FUNDAMENT_AUDIT_2026-05-08.md) | 45 min |

### Auto-genererte (alltid friske)

[docs/auto-generated/](../auto-generated/) — generert fra `main` av CI:
- `API_ENDPOINTS.md` — 227 endpoints
- `DB_SCHEMA_SNAPSHOT.md` — 161 tabeller
- `MIGRATIONS_LOG.md` — kronologisk migration-log
- `MODULE_DEPENDENCIES.md` — backend-domene-graf
- `SERVICES_OVERVIEW.md` — apps/packages-struktur
- `SKILLS_CATALOG.md` — domain-skills-katalog
- `DOC_FRESHNESS.md` — ukentlig sjekk av kanoniske docs (auto-fredag)

[`docs/status/`](../status/) — ukesdigester, generert hver fredag:
- `YYYY-Wnn.md` per ISO-uke (commits, handoffs, postmortems, ADR-er)
- Ny PM kan bla bakover for å forstå utvikling over tid

**Bruk disse FØRST** når du leter etter "current state" — håndskrevne docs kan være stale.

---

## 4.5 MCP-tools og connectors (live data via Cowork/Claude)

Spillorama-PM bruker Cowork/Claude med disse MCP-koblingene:

| MCP | Status | Brukstilfelle |
|---|---|---|
| **Linear** | ✅ Koblet | "Hva er åpne BIN-issues?", "Lukk BIN-NNN", endre status |
| **GitHub** | (innebygd) | PR-mgmt, issues, workflow-runs |
| **Cowork artifacts** | ✅ Innebygd | Lag live PM-dashboard (se `docs/operations/PM_DASHBOARD.md`) |
| **Render** | ❌ Ikke tilgjengelig per 2026-05-10 | Bruk `secrets/render-api.local.md` + curl |
| **Slack/PagerDuty** | (verifiser) | Hvis koblet — alarms til incident-channel |

### Konkrete Linear-MCP-bruksmønstre

I Cowork-chat — disse fungerer fordi MCP-en er koblet:

```
"Vis åpne BIN-issues sortert på prioritet"
→ Claude bruker mcp__linear__list_issues + filter

"Hva er status på BIN-823?"
→ Claude bruker mcp__linear__get_issue

"Marker BIN-815 som Done — commit SHA: abc123"
→ Claude bruker mcp__linear__update_issue + skriver kommentar

"Lag ny BIN-issue: 'Spill 2 leak-test feilet, se /docs/postmortems/2026-05-15-...'"
→ Claude bruker mcp__linear__create_issue
```

**Foretrukket framfor manuell API:** Hvis Linear MCP fungerer, bruk den.
Den har auth allerede, scope er satt korrekt, og PM kan inspisere requestet
før det sendes. Manuell `LINEAR_API_KEY` skal kun brukes av scripts.

### Bekreft hvilke MCP-er som faktisk er aktivert

Ny PM bør verifisere:

```
Spør Claude i Cowork: "List alle MCP-tools du har tilgang til (mcp__*)"
```

Hvis Linear-tools mangler eller returnerer auth-feil — oppdater
`docs/memory/MEMORY.md` §8 og fikse koblingen via Cowork connector-settings.

### PM-dashboard som artifact

Cowork-artifacts kan ha embedded MCP-kall. Du kan be Claude lage en
live PM-dashboard som henter Linear-data ved hver refresh:

> "Opprett en Cowork-artifact som viser åpne BIN-issues, gruppert på status,
> oppdatert hver gang jeg åpner den. Bruk samme stil som
> `scripts/pm-dashboard.html`. Kall den 'Spillorama PM Dashboard (Live)'."

Detaljer: [`docs/operations/PM_DASHBOARD.md`](../operations/PM_DASHBOARD.md).

---

## 5. Kommunikasjons-mønstre med Tobias

Tobias er presis og leser ikke essays. Match hans stil eller du mister tillit.

### 5.1 Direkte direktiver, ikke spørsmål
Når Tobias sier "Vi må…" / "Du skal…" → **DO IT NOW**. Ikke diskuter, ikke planlegg om.

### 5.2 Frustrasjons-signaler trigger PIVOT (ikke beklagelse)
| Signal fra Tobias | Hva han mener | Riktig respons |
|---|---|---|
| "unødvendig mye…" | Arkitektur-refaktor trengs | Foreslå konkret refaktor + estimat |
| "vi må få fremgang nå" | STOP iterasjon | Foreslå alternativ tilnærming |
| "timer med deploy-vent" | Lokal test-side prioritet | Foreslå visual-harness eller fixture |
| "feil at vi ikke har dette på plass" | Manglende fundament | Lag det FØR videre arbeid |

**Aldri si "vi jobber med det"** — si "her er løsningen innen [klokkeslett]".

### 5.3 Tillits-signaler
| Signal | Tolkning |
|---|---|
| "du har gjort en meget god jobb" | Sterkt tilfreds — fortsett kursen |
| Deler API-keys direkte | Høy tillit, vær forsiktig |
| Spør ikke om detaljer | Antar du forstår — verdsetter minimal context-asking |
| "kjør på" | GO — ingen flere spørsmål |

### 5.4 Kvalitets-fokus (IKKE KOMPROMISS)
- "Det er ekstremt viktig at dette alltid funker 100%"
- "ekte penger og feil kan bli ekstremt kostbart"
- "Benchmarking mot Pragmatic Play / Evolution"

**Implikasjon:** bruk debug-endpoints + E2E-tester, ikke gjetning. Skriv tester for kritisk kode. Ikke push uten å verifisere.

### 5.5 Dokumentasjon
- **Verdsetter:** memory, CLAUDE.md, handoff-docs, ADR-er (han leser alle)
- **Ikke verdsetter:** lange forklaringer i chat
- **Kanaler:** kode-kommentarer (kun WHY), commit-messages, kanoniske doc-er

### 5.6 Hva Tobias eier vs hva PM eier

| Aktivitet | Tobias eier | PM eier |
|---|---|---|
| Strategiske beslutninger (pilot-omfang, scope) | ✅ | — |
| Lotteritilsynet-godkjennelser, juridisk | ✅ | — |
| Hardware-anskaffelse (terminaler, TV) | ✅ | — |
| Hall-eier-kontrakter | ✅ | — |
| Pilot-go/no-go-beslutning | ✅ | — |
| Git lokalt (push, pull, merge) | — | ✅ |
| PR-opprettelse + auto-merge | — | ✅ |
| Agent-orkestrering | — | ✅ |
| BACKLOG-oppdatering | — | ✅ |
| ADR-skriving (faktisk skriving) | — | ✅ (med Tobias-godkjennelse på beslutning) |
| Tekniske audit-svar | — | ✅ |

---

## 6. Compliance og regulatorisk (Lotteritilsynet)

### 6.1 Pengespillforskriften — kjerne-§§

| § | Krav | Implementasjon |
|---|---|---|
| **§11** | 15% (hovedspill) eller 30% (databingo) til organisasjoner per kvartal | `app_rg_compliance_ledger` + `OrgDistributionService` |
| **§23** | Self-exclusion minimum 1 år, ikke hevbar | `RgRestrictionService` + `app_rg_restrictions` |
| **§64** | Offentlig spilleplan per hall | `app_game_plan` + `/api/halls/:id/schedule` |
| **§66** | 5-min obligatorisk pause etter 60-min spill | `BINGO_PLAY_SESSION_LIMIT_MS` env + `ResponsibleGamingPersistence` |
| **§71** | Daglig rapport, hash-signed | `app_regulatory_ledger` + daily-anchor cron + `verifyAuditChain` |
| **§82** | Sanksjoner ved brudd (dagsbøter 5k-50k NOK) | — (compliance-eier sin agenda) |

### 6.2 Spillkatalog → §11-prosent

```typescript
// Hard rule — IKKE hardkode
import { ledgerGameTypeForSlug } from "./game/ledgerGameTypeForSlug";

const gameType = ledgerGameTypeForSlug(slug);
// "bingo" | "rocket" | "monsterbingo" → "MAIN_GAME" → 15%
// "spillorama" → "DATABINGO" → 30% + 2500 kr cap
```

### 6.3 Single-prize-cap (2500 kr) — KUN databingo

```typescript
// Pre-fix-bug: hardkodet "DATABINGO" for Spill 1-3 → §11-rapport feil
// Post-fix: bruker ledgerGameTypeForSlug → korrekt
const cap = prizePolicy.applySinglePrizeCap({
  hallId: room.hallId,
  gameType: ledgerGameTypeForSlug(room.gameSlug),  // MAIN_GAME for Spill 1-3 → ingen cap
  amount: requestedPayout,
});
```

### 6.4 Hash-chain audit-trail (BIN-764, ADR-0004)

To parallelle kjeder:
- `app_compliance_audit_log` — generelle audit-events
- `app_wallet_entries` — wallet-mutasjoner

**ALDRI**:
- `UPDATE` eller `DELETE` fra disse tabellene
- Direct INSERT (bypass `AuditLogService` / `WalletAdapter`)
- Endre `canonical_json`-format uten backwards-compat

### 6.5 Audit-historikk og åpne funn

| Audit | Dato | Status | Åpne funn |
|---|---|---|---|
| RNG 1M test | 2026-04-10 | ✅ Lukket | (alle PASS) |
| Spill1/2/3 gameType-fix | 2026-04-25 | ⚠️ Delvis | P0-1 åpen for real-money (ikke pilot) |
| Compliance-readiness | 2026-04-28 | ⚠️ Pilot-OK | P0-1 til P0-4 før real-money |
| Pre-pilot final verify | 2026-05-02 | ✅ Klar | — |
| §71 ledger-verifikasjon | 2026-05-09 | ⚠️ Implementasjon i flight | ADR-0015 — ny tabell `app_regulatory_ledger` |

### 6.6 Compliance-fallgruver (ALDRI gjør)

1. **"2500 kr cap gjelder all bingo"** — Feil. Kun databingo. Bug i kode hvis cap aktiv på MAIN_GAME-paths.
2. **"DATABINGO hardkodet for Spill 2/3"** — Pre-fix bug. Bruk alltid `ledgerGameTypeForSlug(slug)`.
3. **"Compliance multi-hall: bind ledger til master_hall_id"** — Feil. Bind til `actor_hall_id` (kjøpe-hall), ikke master-hall (PR #443).
4. **"Spill 4 er hovedspill"** — Feil. Spill 4 markedsføring = SpinnGo = `spillorama` slug = databingo.
5. **"Premie multiplisering skal være FLAT"** — Feil. Auto-multiplikator: `actualPrize = base × (ticketPrice / 500)`.
6. **"Trafikklys bruker auto-multiplikator"** — Feil. Trafikklys er `explicit_per_color`.
7. **"Oddsen overrider auto-multiplikator helt"** — Halvt riktig. Oddsen overrider KUN Fullt Hus (low/high bucket); Rad 1-4 følger auto-mult.

### 6.7 Lotteritilsynet-prosedyre ved compliance-brudd

1. Detect → SEV-klassifisering (C-P1/P2/P3 i `COMPLIANCE_INCIDENT_PROCEDURE.md`)
2. Notify Lotteritilsynet **innen 24 timer** (skriftlig)
3. Hvis GDPR-relevant: Datatilsynet **innen 72 timer**
4. Implementer korrigerings-rader (append-only, aldri UPDATE/DELETE)
5. Post-mortem dokumentert

---

## 7. Pilot-status og runbooks (R1-R12)

### 7.1 R-tiltak-status (per 2026-05-09)

> **NB om R2/R3-doc-status:** R2/R3 PASSED 2026-05-08 22:39/22:42 per
> [`CHAOS_TEST_RESULTS_R2_R3_2026-05-08.md`](../operations/CHAOS_TEST_RESULTS_R2_R3_2026-05-08.md) (autoritativ kilde).
> De individuelle resultat-doc-ene `R2_FAILOVER_TEST_RESULT.md` + `R3_RECONNECT_TEST_RESULT.md`
> ble skrevet før test ble kjørt og kan vise "Ikke kjørt" på invariants. Bruk
> CHAOS_TEST_RESULTS som kilde, ikke individuelle filer.

| # | Tiltak | Status | Pilot-blokker | Notat |
|---|---|---|---|---|
| R1 | Lobby-rom Game1Controller-wireup | ✅ Merget #1018 + #1033 | Nei (klar) | Spillerklient-wireup §6 i PM_HANDOFF_2026-05-09 |
| R2 | Failover-test (instans-restart) | ✅ PASSED 2026-05-08 | Nei | I1-I5 invariants holder (per CHAOS_TEST_RESULTS) |
| R3 | Klient-reconnect-test | ✅ PASSED 2026-05-08 | Nei | Marks bevart, ingen feil (per CHAOS_TEST_RESULTS) |
| R4 | Load-test 1000 klienter | ⚠️ Ikke startet | Utvidelses-blokker | Post-pilot |
| R5 | Idempotent socket-events | ✅ Implementert (BIN-813) | Nei | `withSocketIdempotency` aktivert |
| R6 | Outbox for room-events | ⚠️ Wallet-side ferdig; rom-side avventer | Utvidelses-blokker | Post-pilot |
| R7 | Health-endpoint per rom | ✅ Merget #1027 | Nei | `/api/games/spill[1-3]/health` |
| R8 | Alerting (Slack/PagerDuty) | ✅ Merget #1031 | Nei | Slack-ready, PagerDuty delvis |
| R9 | Spill 2 24t-leak-test | ⚠️ Infra klar, må kjøres | Utvidelses-blokker | Post-pilot |
| R10 | Spill 3 phase-state-machine chaos | ⚠️ Engine-wireup levert; chaos avventer | Utvidelses-blokker | Post-pilot |
| R11 | Per-rom resource-isolation | ⚠️ Ikke startet | Utvidelses-blokker | Post-pilot |
| R12 | DR-runbook for live-rom | ✅ Merget #1025 | Nei | Drill-pending |

### 7.2 Pilot-go-live-checklist

**Må være GRØNN FØR pilot-go-live-møte:**
- [x] R2 failover-test grønn
- [x] R3 reconnect-test grønn
- [x] R5 idempotent socket-events
- [x] R7 health-endpoint live
- [x] R12 runbook merget
- [ ] R12 drill kjørt minst én gang i staging (gjenstår)
- [ ] R1 final wireup verifisert (PR pending Tobias-bekreftelse)

**Må være GRØNN FØR utvidelse til flere haller:**
- [ ] R4 (load-test 1000)
- [ ] R6 (outbox-validering)
- [ ] R9 (Spill 2 24t-leak)
- [ ] R10 (Spill 3 chaos)
- [ ] R11 (per-rom isolation)
- [ ] 2-4 ukers drift-data fra 4-hall-pilot uten kunde-klager

### 7.3 Pilot-haller (4 stk, første runde)

| Hall | UUID | Rolle |
|---|---|---|
| Teknobingo Årnes | `b18b7928-3469-4b71-a34d-3f81a1b09a88` | Master |
| Bodø | `afebd2a2-52d7-4340-b5db-64453894cd8e` | Deltaker |
| Brumunddal | `46dbd01a-4033-4d87-86ca-bf148d0359c1` | Deltaker |
| Fauske | `ff631941-f807-4c39-8e41-83ca0b50d879` | Deltaker |

**Demo-haller (`demo-hall-001..004`)** brukes for staging-test før prod-cutover.

### 7.4 Pilot-runbooks (når aktiverer)

| Fase | Runbook | Når |
|---|---|---|
| **T-30 dager** | [PILOT_CUTOVER_RUNBOOK.md](../operations/PILOT_CUTOVER_RUNBOOK.md) | Per-hall Unity → web migration |
| **T-7 dager** | [PILOT_PROD_SEEDING_Q3_2026.md](../operations/PILOT_PROD_SEEDING_Q3_2026.md) + drill backup-restore + drill rollback | Seed prod 4 haller, drills mandatory |
| **T-1 dag** | [PILOT_FLOW_TEST_CHECKLIST_2026-05-08.md](../operations/PILOT_FLOW_TEST_CHECKLIST_2026-05-08.md) + [PILOT_SMOKE_TEST_CHECKLIST_2026-04-28.md](../operations/PILOT_SMOKE_TEST_CHECKLIST_2026-04-28.md) | Manuell E2E-flyt + smoke-test |
| **T-0** | [PILOT_GO_LIVE_RUNBOOK_2026-Q3.md](../operations/PILOT_GO_LIVE_RUNBOOK_2026-Q3.md) | Master-timeline integrasjon |
| **T+1 til T+60** | [HALL_PILOT_RUNBOOK.md](../operations/HALL_PILOT_RUNBOOK.md) | Live monitoring + incident response |

### 7.5 Disaster recovery (DR)

7 scenarioer (S1-S7) i [LIVE_ROOM_DR_RUNBOOK.md](../operations/LIVE_ROOM_DR_RUNBOOK.md):
- S1: Master-hall fail
- S2: Multi-hall desync
- S3: Ledger poison
- S4: Wallet corruption
- S5: Rate-limit cascade
- S6: RNG drift
- S7: Network partition

**RPO ≤ 1 time, RTO ≤ 4 timer (live-room < 2 min).** Drill mandatory pre-pilot.

---

## 8. Tekniske prosedyrer (PR, deploy, rollback)

### 8.1 Branch-naming

| Prefix | Bruk |
|---|---|
| `feat/<scope>-<topic>-<date>` | Nye features |
| `fix/<scope>-<topic>-<date>` | Hotfixes |
| `cleanup/<scope>-<topic>-<date>` | Opprydning |
| `chore/<scope>-<topic>-<date>` | Ikke-funksjonelle endringer |
| `test/<scope>-<topic>-<date>` | Tester |
| `docs/<scope>-<topic>-<date>` | Dokumentasjon |
| `agent/slot-<N>` | Agent-worktree (slot 1-3) |

### 8.2 Commit-format (Conventional Commits — blokkerende via danger.yml rule 7)

```
<type>(<scope>): <subject>

<body>

<footer>
```

**Types:** `feat`, `fix`, `chore`, `docs`, `test`, `refactor`, `perf`
**Scopes:** `backend`, `game-client`, `admin-web`, `shared-types`, `infra`, `compliance`

### 8.3 PR-flyt (PM-sentralisert)

```bash
# 1. PM (deg) verifiserer state
git status

# 2. Lag branch
git checkout -b fix/scope-topic-YYYY-MM-DD

# 3. Stage spesifikke filer (ALDRI git add -A)
git add path/to/file.ts

# 4. Commit med Conventional Commits
git commit -m "$(cat <<'EOF'
fix(scope): kort beskrivelse

Detaljer + bakgrunn

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"

# 5. Push og opprett PR med auto-merge
git push -u origin fix/scope-topic-YYYY-MM-DD
gh pr create --title "fix(scope): kort beskrivelse" --body "..."
gh pr merge <nr> --squash --auto --delete-branch

# 6. Verifiser CI etter 5-10 min
gh pr checks <nr>

# 7. Etter merge: pull main
git checkout main && git pull --rebase --autostash

# 8. Gi Tobias hot-reload-restart-kommando (se §2.2)
```

### 8.4 CI-gates (alle blokkerende untatt rule 7 i danger.yml)

| Workflow | Trigger | Blokkering |
|---|---|---|
| `ci.yml` — backend | PR til main | ✅ type-check + tests + boot-test + build |
| `ci.yml` — admin-web | PR til main | ✅ type-check + tests |
| `compliance-gate.yml` | PR + push til main | ✅ `npm run test:compliance` |
| `schema-ci.yml` | PR (migrations/* endret) | ✅ shadow-Postgres migration + diff baseline |
| `architecture-lint.yml` | PR til main | ✅ depcruise (no-cross-app-imports etc) |
| `danger.yml` | PR opened/sync/reopen | ⚠️ Conventional Commits-regex på **PR-tittel** blokkerer (`fail()`). Andre regler er warn/info-nivå. |

### 8.5 Ren restart (ved stuck-state)

```bash
# Drep alle stale prosesser
ps aux | grep -E "tsx watch.*src/index.ts|spillorama|dev:all|start-all\.mjs" | grep -v grep | awk '{print $2}' | xargs -r kill -9

# Flush Redis
docker exec spillorama-system-redis-1 redis-cli FLUSHALL

# Cancel stale runder
PGPASSWORD=spillorama psql -h localhost -U spillorama -d spillorama -c "
UPDATE app_game1_scheduled_games SET status='cancelled', actual_end_time=now()
WHERE status IN ('running','purchase_open','ready_to_start','paused');
UPDATE app_game_plan_run SET status='finished', finished_at=now()
WHERE status NOT IN ('finished','idle');"

# Restart full stack
cd /Users/tobiashaugen/Projects/Spillorama-system && npm run dev:all
```

### 8.6 Migration deploy

`render.yaml` `buildCommand` kjører `npm run migrate` automatisk. Migrasjonene MÅ være:
- **Idempotente** (`CREATE TABLE IF NOT EXISTS`, `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`) — ADR-0014
- **Forward-only** (ingen DOWN-migrasjon)
- **Tidsstemplet etter siste eksisterende** (Render runner avviser back-dated)

Hvis migration feiler → build aborts → app forblir på forrige versjon (no downtime).

### 8.7 Rollback (per-hall via flag, ikke schema-revert)

Per `ROLLBACK_RUNBOOK.md`:
- Per-hall `client_variant` flag (unity/web/unity-fallback) — 60s in-process cache
- 2-of-3 godkjennelse: on-call + tech-lead + product-owner
- **DB-rollback finnes IKKE** — vi er forward-only per ADR-0014. Hvis migration var feil, skriv NY migration som korrigerer. Aldri revertér eller endre eksisterende migration.

### 8.8 Render API + dashbord

- **Dashboard:** https://dashboard.render.com/
- **Service ID:** `srv-d7bvpel8nd3s73fi7r4g`
- **Health:** https://spillorama-system.onrender.com/health
- **API-key:** se [PM_HANDOFF_2026-05-07.md §"Operasjonell info"](../operations/PM_HANDOFF_2026-05-07.md)

---

## 9. Anti-mønstre og fallgruver

### 9.1 Git anti-mønstre

| ❌ Aldri | ✅ Gjør i stedet |
|---|---|
| `git add -A` (kan plukke .env, secrets) | `git add path/to/file.ts` (eksplisitt) |
| `--no-verify` på commit | Fix hooks-feil |
| `git commit --amend` på pushed commit | Lag ny commit |
| `git push --force` til main | Aldri (branch-protection blokkerer) |
| Agent åpner PR | PM eier PR |
| Agent merger PR | PM eier merge |
| `gh pr merge --merge` (no-ff) | `gh pr merge --squash --auto --delete-branch` |
| Lukke Linear-issue på branch-merge | Vent på main-merge + verifiser |
| Lage kjedede PR-er der B baserer på A uten rebase mellom squash-merger | Rebase B mot main etter A merges, ELLER bruk combined PR fra start (cherry-pick alle commits til én branch fra main). Squash-merge gir ny SHA → kjedet PR blir `mergeable: CONFLICTING/DIRTY` ellers. Se PM_HANDOFF_2026-05-10 §8. |

### 9.2 Compliance anti-mønstre

| ❌ Aldri | ✅ Gjør i stedet |
|---|---|
| Hardkode `gameType: "DATABINGO"` for Spill 1-3 | `ledgerGameTypeForSlug(slug)` |
| Apply 2500 kr cap på Spill 1-3 (MAIN_GAME) | Cap kun for `gameType === "DATABINGO"` |
| Bind compliance-ledger til master-hall | Bind til `actor_hall_id` (kjøpe-hall) |
| Direct INSERT i `app_compliance_audit_log` | Bruk `AuditLogService.record()` |
| `UPDATE`/`DELETE` audit-trail | Append korrigerings-rad (referer original) |
| Bypass §66-pause | Server håndhever; klient kan aldri overstyre |

### 9.3 Wallet anti-mønstre

| ❌ Aldri | ✅ Gjør i stedet |
|---|---|
| Direct INSERT i `app_wallet*` tabeller | Bruk `WalletAdapter`-interface |
| Operasjon uten `idempotencyKey` | Bruk `IdempotencyKeys.<operation>(...)` |
| `socket.emit()` etter wallet-mutering | Skriv til outbox først, worker emitter |
| `SERIALIZABLE` på wallet-debit | `REPEATABLE READ` (BIN-762) |
| Hopp over single-prize-cap-sjekk | `prizePolicy.applySinglePrizeCap()` |

### 9.4 Live-rom anti-mønstre

| ❌ Aldri | ✅ Gjør i stedet |
|---|---|
| Lager nye socket-paths uten R5-idempotens | Wrap med `withSocketIdempotency` |
| Antar Redis er pålitelig | Graceful degradation til Postgres-only |
| Endrer `GameRoomHealth`-shape uten å oppdatere route | Update `publicGameHealth.ts` samtidig |
| Skipper rate-limit på health-endpoint | DoS-risk; verifiser 60/min/IP |

### 9.5 Spill 1-spesifikke anti-mønstre

| ❌ Aldri | ✅ Gjør i stedet |
|---|---|
| Sender `plan-run-id` til master-actions | Bruk `currentScheduledGameId` fra aggregator |
| Lager NY GoH når seed-GoH eksisterer | Edit eksisterende eller hard-delete |
| Phantom-rom etter restart | FLUSHALL Redis + restart |
| Antar Spill 2/3 har master | De har IKKE master — perpetual-loop |
| Antar Spill 1 har auto-restart | Spill 1 er master-styrt mellom runder |
| Konvertere Spill 1 til perpetual-modell | Regulatorisk korrekt som master-styrt (§64/§71) |

### 9.6 Migration anti-mønstre

| ❌ Aldri | ✅ Gjør i stedet |
|---|---|
| Back-dated timestamp | Etter siste eksisterende migration |
| Non-idempotent migration | `IF NOT EXISTS` på CREATE TABLE/INDEX |
| DOWN-migration | Forward-only — fix-forward |
| Drop column med eksisterende data | Backward-compat-shim først, deretter drop |
| Manual SQL-fix uten migration | Lag migration som dokumenterer fix |

### 9.7 Tobias-kommunikasjons anti-mønstre

| ❌ Aldri | ✅ Gjør i stedet |
|---|---|
| Lange chat-essays | Kort, konkret, handlings-orientert |
| "Vi jobber med det" | "Her er løsningen innen [klokkeslett]" |
| Stille spørsmål han allerede har svart på | Søk i memory + handoff først |
| Foreslå nye refaktor-bølger uten direktiv | Vent på eksplisitt direktiv |
| Glem `cd /Users/...` foran kommandoer | ALLTID `cd` først (Tobias er ofte i `~`) |

---

## 10. Sjekkpunkter for fullført onboarding

Du er klar når du kan svare JA på alle disse spørsmålene:

### ⛔ Vanntett gate (MÅ være krysset av)
- [ ] `bash scripts/pm-checkpoint.sh --validate` returnerer exit 0
- [ ] `.pm-onboarding-confirmed.txt` finnes i repo-rot og er ≤ 7 dager gammel
- [ ] Jeg har skrevet ekte takeaway per PM_HANDOFF (ikke placeholder som "lest")
- [ ] Jeg er forberedt på at Tobias kan be om å se filen som bevis

### Fundament
- [ ] Jeg har lest §2 (Tobias-direktiver) og kan referere immutable kontrakter
- [ ] Jeg vet forskjellen mellom Spill 1, 2, 3 (rom-modell, master, perpetual)
- [ ] Jeg vet at Spill 4 = SpinnGo = `spillorama` slug = databingo (ikke hovedspill)
- [ ] Jeg vet at Game 4 / `themebingo` er deprecated

### Lese-disiplin (FØR alle andre sjekkpunkter)
- [ ] Jeg har lest §2 (Tobias' immutable direktiver) i sin helhet
- [ ] Jeg har lest §3 trinn-rutinen + fulgt den
- [ ] **Jeg har lest ALLE PM-handoffs siden 2026-04-23** (eller siden forrige jeg leste hvis ikke ny)
- [ ] Jeg har lest tema-spesifikke audits + design-doc-er per §3.1 (basert på scope)
- [ ] Jeg har lest `MASTER_README.md` + `docs/SYSTEM_DESIGN_PRINCIPLES.md`
- [ ] Jeg har lest `SPILL_REGLER_OG_PAYOUT.md` hvis jeg skal røre payout-kode
- [ ] Jeg har lest `SPILL[1-3]_IMPLEMENTATION_STATUS_2026-05-08.md` hvis jeg skal røre spill-kode
- [ ] Jeg har lest `LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08.md` hvis jeg skal røre rom-arkitektur
- [ ] **Jeg har skummet `PITFALLS_LOG.md` og lest §-er for mitt scope** (§1.x compliance, §2.x wallet, §3.x spill-arkitektur, §4.x live-rom, §5.x git, §6.x test, §7.x frontend, §8.x doc-disiplin, §11.x agent-orkestrering)
- [ ] **Jeg har skummet `AGENT_EXECUTION_LOG.md` for tidligere agent-arbeid på samme scope**

### Compliance
- [ ] Jeg vet at 2500 kr cap KUN gjelder databingo, ikke hovedspill
- [ ] Jeg vet at `ledgerGameTypeForSlug()` er ENESTE mapping fra slug til gameType
- [ ] Jeg vet at compliance-ledger binder til `actor_hall_id` (kjøpe-hall), ikke master-hall
- [ ] Jeg vet hvor §11/§66/§71 håndheves i koden
- [ ] Jeg vet at audit-trail er append-only (ingen UPDATE/DELETE)

### Workflow
- [ ] Jeg vet hvordan PM-sentralisert git-flyt fungerer (Agent commit/push, PM eier PR/merge)
- [ ] Jeg vet hvordan Done-policy fungerer (commit til main + file:line + grønn test)
- [ ] Jeg vet at Tobias rør aldri git lokalt — PM eier auto-pull etter merge
- [ ] Jeg vet hot-reload-restart-kommandoen og at den må starte med `cd /Users/...`
- [ ] Jeg vet at jeg må verifisere `gh pr checks <nr>` 5-10 min etter PR-åpning

### Pilot
- [ ] Jeg vet R1-R12 status og hvilke som er pilot-blokkere vs utvidelses-blokkere
- [ ] Jeg vet at pilot-omfang er 4 haller (Årnes master + Bodø + Brumunddal + Fauske)
- [ ] Jeg vet at utvidelse betinger 2-4 ukers stabilitet + R4/R6/R9
- [ ] Jeg vet hvor pilot-runbooks ligger og når de aktiveres

### Tekniske detaljer
- [ ] Jeg vet at server er sannhets-kilde, klient er view
- [ ] Jeg vet outbox-pattern (state + event i samme TX)
- [ ] Jeg vet hash-chain audit-trail (BIN-764)
- [ ] Jeg vet idempotency-mønster (`clientRequestId` + `idempotencyKey`)
- [ ] Jeg vet auto-multiplikator: `actualPrize = base × (ticketPrice / 500)`

### Dokumentasjon
- [ ] Jeg har generert `/tmp/pm-onboarding.md` og lest den
- [ ] Jeg har lest siste `PM_HANDOFF_*.md`
- [ ] Jeg har lest MASTER_README + SYSTEM_DESIGN_PRINCIPLES + denne playbook
- [ ] Jeg har bekreftet til Tobias at jeg har full kontekst

### Action-readiness
- [ ] Jeg har konkret plan for sesjonen
- [ ] Jeg har spørsmålsliste til Tobias for uklarheter
- [ ] Jeg vet hva som er neste handling (PR, agent-spawn, research)
- [ ] Jeg har grønt lys fra Tobias før jeg starter ikke-reverserbar handling

### Sesjons-slutt-sjekkliste (FØR du logger av)
- [ ] **Skrev jeg PM_HANDOFF_<dato>.md** med komplett kontekst for neste PM?
- [ ] **Oppdaterte jeg PM_ONBOARDING_PLAYBOOK** med nye direktiver, anti-mønstre, R-status-endringer (se §11)?
- [ ] **Oppdaterte jeg BACKLOG.md** hvis pilot-blokker-status endret seg?
- [ ] **Oppdaterte jeg Linear-issues** med Done-policy (commit til main + file:line + grønn test)?
- [ ] **Skrev jeg ADR** hvis det ble fattet arkitektonisk beslutning?
- [ ] **Pulled jeg main** i hovedrepoet etter siste merge?
- [ ] **Ga jeg Tobias hot-reload-restart-kommando** etter siste merge?

---

## 11. Vedlikehold av playbook (FLYTENDE DOKUMENT)

> **🚨 KRITISK PRINSIPP:** Denne playbook er et **flytende dokument**. Hver PM
> ER ANSVARLIG for å oppdatere den ved sesjons-slutt slik at neste PM har
> 100% kunnskaps-paritet. Hvis du ikke oppdaterer, mister vi det viktigste
> verktøyet vi har for kontinuitet på tvers av PM-overganger.

### Tobias' direktiv (2026-05-09)

> "Det er greit at PM kan gjøre endringer i playbook utifra hva de gjør. Dette dokumentet skal være flytende — PM må alltid oppdatere med hva som er gjort slik at ny PM etter alltid har samme kunnskap som forrige PM."

### MÅ-oppdater ved sesjons-slutt (obligatorisk)

Når du avslutter en sesjon, **gå gjennom denne sjekklisten**:

- [ ] **§2 (Tobias-direktiver):** Har Tobias gitt ny immutable direktiv? Legg det inn med dato.
- [ ] **§5 (Kommunikasjons-mønstre):** Har du lært et nytt mønster? Eks. ny frustrasjons-trigger, nytt tillits-signal.
- [ ] **§6 (Compliance):** Har audit-status endret seg? Lukket noen åpne funn? Nye §§-tolkninger?
- [ ] **§7 (Pilot-status R1-R12):** Har noen R-tiltak gått fra ⚠️ til ✅? Eller blitt blokker? Oppdater tabell.
- [ ] **§7.3 (Pilot-haller):** Endret hall-liste? Nye UUID-er?
- [ ] **§9 (Anti-mønstre):** Har du oppdaget en ny fallgruve under sesjonen? Legg den inn.
- [ ] **Tier-listene i §4:** Nye doc-er som ny PM må lese? Stale doc-er som er deprecated?
- [ ] **Vedlegg A (login):** Endret credentials, hall-IDer eller ny demo-bruker?
- [ ] **Vedlegg B (URL-er):** Nye endpoints, dashboards eller test-URL-er?
- [ ] **Vedlegg C (skill-katalog):** Nye eller deprecated skills?

**Ved hver oppdatering:**
1. Oppdater "Sist oppdatert"-dato på toppen av filen
2. Legg til entry i §11.5 endringslogg ("Endringer fra denne sesjonen")
3. Commit som del av ditt PM-handoff-arbeid (egen commit eller del av sesjons-PR)

### KAN-oppdater (anbefalt men ikke obligatorisk)

- §1 hvis tech-stack endres
- §3 hvis trinn-rutinen blir bedre/raskere
- §8 hvis CI/CD-pipelines endres
- Vedlegg hvis nye verktøy/scripts kommer til

### Når IKKE oppdatere

- Daglig task-tracking (det hører i Linear)
- Spesifikke bugs fra én sesjon (legg i `PM_HANDOFF_<dato>.md`)
- Stake-snapshots (legg i handoff)
- Ferdig-arbeid (flytt til BACKLOG.md "Ferdig"-seksjon)
- Åpne PR-er som ikke er merget enda (de hører i handoff/Linear)

### Hvordan oppdatere

```bash
# 1. Lag branch (kan kombineres med sesjons-handoff-PR)
git checkout -b docs/pm-playbook-update-YYYY-MM-DD

# 2. Edit
vim docs/engineering/PM_ONBOARDING_PLAYBOOK.md

# 3. Oppdater "Sist oppdatert"-dato på toppen + endringslogg

# 4. Commit + PR
git add docs/engineering/PM_ONBOARDING_PLAYBOOK.md
git commit -m "docs(engineering): update PM_ONBOARDING_PLAYBOOK after [sesjon-tema]"
git push -u origin docs/pm-playbook-update-YYYY-MM-DD
gh pr create --title "..." --body "..."
gh pr merge <nr> --squash --auto --delete-branch
```

### §11.5 Endringer fra denne sesjonen

**Hver PM legger til en blokk her ved sesjons-slutt:**

```markdown
#### YYYY-MM-DD (PM-AI: [model-versjon])
- §X: [hva ble oppdatert + hvorfor]
- §Y: [hva ble oppdatert + hvorfor]
- Nye anti-mønstre: [liste]
- Nye Tobias-direktiver: [liste]
```

#### 2026-05-11 (PM-AI: Claude Opus 4.7)
- §2.2: Standard restart-kommando byttet fra selective admin-restart til `npm run dev:nuke`. Tobias-direktiv: "Kan du legge inn i rutinen at det alltid skal sendes dev:nuke slik at vi vet at alle andre prosesser avsluttes?" — sikrer clean state på tvers av alle lag (backend + admin-web + game-client + visual-harness + Docker + Redis + Postgres-stale-runder).
- Memory `feedback_dev_nuke_after_merge.md` lagt til (superseder `feedback_pm_pull_after_merge.md`-restart-kommandoen).
- Nye Tobias-direktiver: alltid `npm run dev:nuke` etter merge, aldri selective restart.

#### 2026-05-14 (Agent S: DB-observability-aktivering)
- Vedlegg B: PgHero DB-dashbord (`http://localhost:8080`) lagt til som ny URL. Aktiveres via `npm run dev:nuke -- --observability` for pilot-test-sesjoner. Login: `admin / spillorama-2026-test`.
- `docker-compose.yml`: postgres-service fikk permanent `command:`-blokk som setter `shared_preload_libraries=pg_stat_statements` + `pg_stat_statements.track=all` + `log_min_duration_statement=100ms`. Migration `20261225000000_enable_pg_stat_statements.sql` ble installert tidligere, men extension samlet INGEN data uten denne `command:`-blokken — Tobias' opprinnelige rapport ("vi skulle vente med database verktøy men alt er satt opp"-feilsituasjonen) er nå fikset.
- `scripts/dev/start-all.mjs`: lagt til `--observability`-flag (opt-in) + `OBSERVABILITY_ENABLED` env-var. Starter PgHero etter migrate. Status-tabell viser PgHero-URL når flagget er aktivt.
- `scripts/dev/nuke-restart.sh`: forwarder `--observability` til `dev:all`. Kommando: `npm run dev:nuke -- --observability`.
- `docs/operations/PGHERO_PGBADGER_RUNBOOK.md` oppdatert: §2 quick-start nevner nå `dev:nuke -- --observability`. §3 oppdatert til å reflektere at extension er permanent aktivert (ikke lenger "valgfritt").
- Nye Tobias-direktiver: "overvåk DB-prosessen i testfasen slik at vi kan optimalisere" — DB-observability skal være på under pilot-test for å fange slow queries før prod-utrulling.
- Nye anti-mønstre: PITFALLS §6.X — `pg_stat_statements`-extension installert via migration er IKKE nok; `shared_preload_libraries` MÅ settes på Postgres-prosessen ved oppstart. Installert ≠ aktivert.

### Flytende-doc-disiplin (regel)

Hvis du som PM gjør **arbeid** som påvirker innholdet i playbook (eks. "vi
fant et nytt anti-mønster", "Tobias ga ny direktiv om X", "R-tiltak Y er
nå grønt"), så er det IKKE valgfritt å oppdatere playbook. Det er en del av
sesjonens leveranse — på linje med å oppdatere BACKLOG.md eller
PM_HANDOFF.

**Konsekvens av å hoppe over:** neste PM må re-oppdage det du allerede vet,
spør Tobias om ting han allerede har svart på, og kunnskapsbase-en
forvitrer. Tobias-direktiv 2026-05-09: dette er det viktigste verktøyet
vi har for kontinuitet.

### Når oppdater (kort sammendrag)

Oppdater denne playbook når:

1. **Ny ADR overstyrer eksisterende mønster** — særlig ADR-0009 (PM-flyt), ADR-0010 (Done-policy), ADR-0014 (idempotent migrations)
2. **Nye pilot-haller** — oppdater §7.3-tabell
3. **R-tiltak går fra ⚠️ til ✅** — oppdater §7.1
4. **Tobias gir ny direktiv** som er immutable — legg i §2
5. **Tech-stack endres** — oppdater §1
6. **Større endring i compliance-håndhevelse** — oppdater §6
7. **Nye anti-mønstre oppdages** — legg i §9
8. **Du som PM lærer noe nytt** som ny PM ikke vil vite — flett inn relevant seksjon

### Hva skal IKKE i playbook

- Daglig task-tracking (det er Linear)
- Utdaterte stake-snapshots (de hører i `docs/operations/PM_HANDOFF_*.md`)
- Spesifikke bugs fra én sesjon (legg i handoff)
- Ferdig-arbeid (flytt til `BACKLOG.md` "Ferdig"-seksjon)

### Hvordan oppdatere

```bash
# 1. Lag branch
git checkout -b docs/pm-onboarding-playbook-update-YYYY-MM-DD

# 2. Edit
vim docs/engineering/PM_ONBOARDING_PLAYBOOK.md

# 3. Oppdater "Sist oppdatert"-dato på toppen

# 4. Commit + PR
git add docs/engineering/PM_ONBOARDING_PLAYBOOK.md
git commit -m "docs(engineering): update PM_ONBOARDING_PLAYBOOK for [endring]"
git push -u origin docs/pm-onboarding-playbook-update-YYYY-MM-DD
gh pr create --title "..." --body "..."
gh pr merge <nr> --squash --auto --delete-branch
```

### Regelmessig review

PM bør sjekke playbook-en hver 2. uke for:
- Stale doc-pekere (filer flyttet/slettet)
- Endrede defaults eller paths
- Nye ADR-er som ikke er reflektert
- Nye fallgruver fra audit/incidents

---

## Vedlegg A — Login-credentials

| Rolle | E-post | Passord-hint | Hall |
|---|---|---|---|
| Admin | `tobias@nordicprofil.no` | Spillorama123! | (ingen) |
| Master-agent (prod) | `tobias-arnes@spillorama.no` | Samme | Teknobingo Årnes |
| Master-agent (demo) | `demo-agent-1@spillorama.no` | Samme | demo-hall-001 |
| Sub-agent 2 (demo) | `demo-agent-2@spillorama.no` | Samme | demo-hall-002 |
| Sub-agent 3 (demo) | `demo-agent-3@spillorama.no` | Samme | demo-hall-003 |
| Sub-agent 4 (demo) | `demo-agent-4@spillorama.no` | Samme | demo-hall-004 |
| Spiller 1 (demo) | `demo-pilot-spiller-1@example.com` | Samme | demo-hall-001 |

> **NB om demo-spillere:** Seed-script (`apps/backend/scripts/seed-demo-pilot-day.ts`)
> seeder TO grupper:
> - **Profil A (master-hall):** `demo-spiller-1@example.com`, `demo-spiller-2@example.com`, …
> - **Profil B (alle 4 demo-haller):** `demo-pilot-spiller-1..12@example.com`
>
> Bruk Profil B for fullstendig pilot-flyt-test (multi-hall). Profil A for raskt master-hall-test.

Tobias deler passord direkte i chat — Anthropic-policy hindrer AI å fylle inn passord på vegne av ham.

---

## Vedlegg B — URL-er for testing

| URL | Hva |
|---|---|
| `http://localhost:5174/admin/` | Admin-konsoll |
| `http://localhost:5174/admin/agent/cashinout` | Master cash-inout dashboard |
| `http://localhost:5174/admin/agent/games` | NextGamePanel |
| `http://localhost:5174/admin/#/games/catalog` | 13 katalog-spill |
| `http://localhost:5174/admin/#/groupHall` | GoH master-hall-velger |
| `http://localhost:4000/web/?dev-user=demo-pilot-spiller-1` | Spillerklient |
| `http://localhost:4000/admin/#/tv/demo-hall-001/<token>` | TV-skjerm |
| `http://localhost:4000/api/games/spill1/health?hallId=demo-hall-001` | R7 health-endpoint |
| `http://localhost:8080` | **PgHero DB-dashbord** (OBS-7/OBS-8) — kun med `npm run dev:nuke -- --observability`. Login: admin / spillorama-2026-test. Slow queries, missing indexes, live connections. |
| https://spillorama-system.onrender.com/ | Prod |
| https://spillorama-system.onrender.com/health | Prod health |

> **PgHero (OBS-7/OBS-8):** Tobias-direktiv 2026-05-14: "overvåk DB-prosessen i testfasen slik at vi kan optimalisere." Bruk `npm run dev:nuke -- --observability` for pilot-test-sesjoner — da starter PgHero på `:8080` ved siden av backend/admin/game-client. Default off for å holde startup rask. `pg_stat_statements` + `log_min_duration_statement=100ms` er permanent aktivert i `docker-compose.yml` (uavhengig av flagg) så data samles fra T-0. Se [PGHERO_PGBADGER_RUNBOOK.md](../operations/PGHERO_PGBADGER_RUNBOOK.md).

---

## Vedlegg C — Skill-katalog (20 domain-skills)

Last KUN når du redigerer kode i det domenet (lazy per-task).

**Pilot-kritiske (les først):**
1. `live-room-robusthet-mandate` — R1-R12 mandat
2. `spill1-master-flow` — Master-konsoll, plan-runtime
3. `wallet-outbox-pattern` — Outbox + REPEATABLE READ + hash-chain
4. `audit-hash-chain` — BIN-764 immutability
5. `pengespillforskriften-compliance` — §11/§66/§71
6. `pm-orchestration-pattern` — Git-flyt + Done-policy
7. `goh-master-binding` — Group of Halls, master-hall-pin

**Domene-spesifikke:**
8. `spill2-perpetual-loop` — Spill 2 (rocket)
9. `spill3-phase-state-machine` — Spill 3 (monsterbingo)
10. `spinngo-databingo` — SpinnGo (databingo)
11. `agent-portal-master-konsoll` — UI for master
12. `agent-shift-settlement` — Shift + settlement
13. `customer-unique-id` — Walk-in prepaid-kort
14. `anti-fraud-detection` — Velocity, deviation
15. `health-monitoring-alerting` — R7/R8
16. `dr-runbook-execution` — DR scenarios
17. `database-migration-policy` — ADR-0014
18. `trace-id-observability` — MED-1
19. `casino-grade-testing` — Chaos-tests
20. `candy-iframe-integration` — Wallet-bro

**Tech-stack (last hvis du redigerer i teknologien):**
- `bun`, `docker`, `express`, `node`, `pixi`, `playwright`, `postgresql`, `redis`, `socket.io`, `typescript`, `vite`, `vitest`, `zod`

---

## Endringslogg

| Dato | Endring | Forfatter |
|---|---|---|
| 2026-05-09 | Initial — komplett PM-onboarding-playbook generert fra 6 parallelle research-agenter | PM-AI (Claude Opus 4.7 + 6 Explore-agenter) |
| 2026-05-10 | Spillerklient-rebuild fase 1+2+3+4 fullført (5 PR-er merget i én sesjon). Pilot-blokker for spillerklient fjernet. Ny lærdom (§9 anti-mønstre): kjedede PR-er må rebases mot main mellom hvert squash-merge ELLER bruk combined PR for å unngå CONFLICTING-state. Se PM_HANDOFF_2026-05-10 §8. | PM-AI (Claude Opus 4.7) |
| 2026-05-11 | Evolution-grade Bølge 1 + Bølge 2 levert (20 PR-er). ADR-0017 (fjerne daglig jackpot), ADR-0019 (Bølge 1 P0-konsistens), ADR-0020 (Bølge 2 utvidelses-fundament), ADR-0021 (master kan starte med 0 spillere). §2.2 standard restart-kommando byttet til `npm run dev:nuke` (Tobias-direktiv om "alle prosesser avsluttes"). | PM-AI (Claude Opus 4.7) |

---

**Til nestemann:** Hvis du leser dette som ny PM, husk: dette er kontrakt mellom Tobias og PM-rollen. Avvik må eskaleres til Tobias — ikke bare implementeres.

**Lykke til. Fundamentet er solid. Pilot er nær. Du har all kontekst du trenger.**
