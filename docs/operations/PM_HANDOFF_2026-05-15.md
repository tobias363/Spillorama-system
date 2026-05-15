# PM-handoff 2026-05-15 — BuyPopup-redesign levert + STRUKTURELL BUG identifisert (purchase_open)

**Forrige PM:** Claude Opus 4.7 (Cowork-sesjon 2026-05-15, ~08:00-20:30)
**Ny PM:** [Navn settes ved overtagelse]
**Sesjons-tema:** BuyPopup-design rebuild + 3-layer triple-bong-fix + strukturell `purchase_open`-bug oppdaget under live test.
**Status pilot-go-live:** **BLOKKERT.** Spill 1 har ikke fungerende ticket-purchase-fase i live-flyt — scheduled-game hopper direkte fra `scheduled` → `running` uten å passere `purchase_open`. Strukturell fix valgt (Option B per Tobias).

---

## 0. ⛔ FØR DU GJØR NOEN TING — Onboarding-gate (vanntett)

**Tobias-direktiv 2026-05-10 (IMMUTABLE):** Du har **FORBUD** mot å skrive kode før du har passert PM-onboarding-gate.

```bash
cd /Users/tobiashaugen/Projects/Spillorama-system
bash scripts/pm-checkpoint.sh --validate    # exit 0 = passert
```

Hvis exit ≠ 0:

```bash
bash scripts/pm-checkpoint.sh
bash scripts/pm-doc-absorption-gate.sh    # NY 2026-05-14 — leser KNOWLEDGE_EXPORT også
```

**Også les denne sesjons-eksport:** `docs/operations/PM_SESSION_KNOWLEDGE_EXPORT_2026-05-15.md` (lest sammen med denne handoff for full kontekst).

---

## 1. Hovedoppgave (KRITISK, P0)

### 🚨 STRUKTURELL BUG: `purchase_open`-fasen er ikke wired i live-flyt

**Tobias-direktiv 2026-05-15 (IMMUTABLE — selve regel-spec-en):**

> "Det skal være mulig å kjøp bonger til neste spill uten at master har startet spillet. Det er selve poenget — man venter til bonger er kjøpt, deretter starter master spillet."

**Observert atferd (live test 2026-05-15 20:15-20:18, scheduled_game `e8c023f5-ad28-4673-986f-51dac4211dd7`):**

| Tid | Event |
|---|---|
| 18:15:28 | `scheduled_start_time` (5 min etter master.start) |
| 18:15:31 | `actual_start_time` — engine starter etter 2.2s, **ingen purchase_open-fase** |
| 18:15:31-18:16:53 | Engine trekker alle 75 baller på 82 sekunder uten at en eneste bong-purchase ble registrert i `app_game1_ticket_purchases` |
| 18:16:53 | `actual_end_time` — game completed med 0 vinnere |
| 18:17:43 | `plan_run.status = 'finished'` etter kun posisjon 1 av 13 |

**Bevis i database:**
```sql
SELECT id, status, actual_start_time, actual_end_time,
       EXTRACT(EPOCH FROM (actual_end_time - actual_start_time)) AS duration_sec
FROM app_game1_scheduled_games
WHERE id='e8c023f5-ad28-4673-986f-51dac4211dd7';
-- Resultat: status=completed, duration=82.09s, 0 purchases

SELECT COUNT(*) FROM app_game1_ticket_purchases
WHERE scheduled_game_id='e8c023f5-ad28-4673-986f-51dac4211dd7';
-- Resultat: 0
```

**Hvorfor:** Browser viste error `Ingen pre-round billett med id=BINGO_DEMO_PILOT-GOH:1f110dd6-...:bundle:0` da spilleren prøvde å kjøpe bonger MENS engine raste gjennom trekninger. Bundle-ID-en eksisterer ikke fordi `purchase_open`-fasen aldri inntraff — `Game1ScheduleTickService.openPurchaseForImminentGames` ble ikke trigget eller flippet ikke status korrekt.

**Forventet flyt (Tobias-direktiv):**
```
scheduled → purchase_open (bonger kjøpes) → ready_to_start (master signaliserer klar) → running (master starter engine) → completed
```

**Faktisk flyt i dag:**
```
scheduled → running (master starter direkte) → completed
```

### Hva som er bekreftet eksisterer i kode

- `apps/backend/src/game/Game1ScheduleTickService.ts` har `openPurchaseForImminentGames`-metoden — flipper `scheduled → purchase_open` når `scheduled_start_time - X min < now`
- Status `purchase_open` finnes i state-machine
- `Game1TicketPurchaseService` aksepterer kjøp i `purchase_open`-state
- Front-end forventer pre-round bundle-IDs fra `purchase_open`-fasen

### Hva som ikke fungerer

1. **Cron-flip skjer aldri i live test** — 392 historiske scheduled-games (per Bash-query 20:18) gikk alle direkte fra `scheduled` → `running` uten innom `purchase_open`. Sannsynlige årsaker:
   - Cron-job skedulert men kjører ikke
   - `scheduled_start_time` settes for tett opp mot master.start så time-vinduet aldri åpner
   - `MasterActionService.start` triggerer engine direkte uten å vente på `purchase_open`-flipp

2. **Master.start hopper over `purchase_open`-validering** — i `MasterActionService.start()` er det ingen guard som sjekker at scheduled-game er i `ready_to_start` før engine startes. Den starter rett fra `scheduled`.

3. **Stale demo-games i `scheduled`-state** — 13 rader fra 14-15. mai 11:00 (9+ timer gamle) sitter i `scheduled` uten å være flippet. Beviser cron ikke kjører som forventet.

### Konkrete fix-paths som må vurderes FØRST (før full strukturell rewrite)

**Tobias-spørsmål 2026-05-15 ~20:35:** Disse må fikses først som umiddelbar PR — kan stå alene eller være Trinn 1 av full Option B:

**B.1 — Fix purchase_open-vinduet ved seed (raskeste fix, kan landes samme dag):**
- Oppdater `apps/backend/scripts/seed-demo-pilot-day.ts` (eller tilsvarende seed) så scheduled-games får `scheduled_start_time = now + 5-10 min` i stedet for fast `11:00`.
- Gir cron `Game1ScheduleTickService.openPurchaseForImminentGames` et reelt time-vindu å flippe `scheduled → purchase_open` på.
- **Pro:** Minimal-invasiv, ingen MasterActionService-endringer, tester eksisterende cron-kode.
- **Kontra:** Løser kun demo-seed, ikke prod-flyt. Hvis `MasterActionService.start` fortsatt hopper over `purchase_open`, hjelper det ikke.

**B.2 — Endre cron til å flippe stale `scheduled` → `purchase_open` umiddelbart:**
- I `Game1ScheduleTickService.openPurchaseForImminentGames`: relakser betingelsen så ALLE `scheduled`-rader med `now() > scheduled_start_time - 30min` flippes umiddelbart (ikke kun "innenfor nær fremtid").
- Eller: legg til ny metode `forceFlipToPurchaseOpen(scheduledGameId)` som kalles av `MasterActionService.start` eksplisitt.
- **Pro:** Fikser også de 13 stale demo-games + sikrer at master.start alltid passerer via `purchase_open`.
- **Kontra:** Krever endring i cron-logikk + sannsynligvis i `MasterActionService.start` for å vente på flip.

**B.3 — Full strukturell rewrite (Option B original — lengste vei):**

Implementer ekte `purchase_open`-fase med:

1. **`MasterActionService.start()` endres:**
   - Lager scheduled-game i status `purchase_open` (ikke `ready_to_start`)
   - `scheduled_start_time = now + GAME1_PURCHASE_WINDOW_MS` (default 2 min, admin-konfigurerbar)
   - Returnerer til UI med "Bongesalg åpent — venter på spillere"

2. **Ny endpoint `POST /api/agent/game1/master/ready-to-start`:**
   - Flipper `purchase_open → ready_to_start`
   - Krever at minst 1 purchase finnes (kan overstyres med `forceStart=true`)
   - Triggerer engine via `Game1MasterControlService.startGame()`

3. **Master-UI får 2 knapper:**
   - "Start neste spill" → oppretter scheduled-game i `purchase_open`
   - "Start trekninger nå" → flipper til `ready_to_start` + starter engine (vises kun når status=`purchase_open`)

4. **Frontend buy-flow:**
   - Klient subscribes på lobby-rom → mottar `purchase_open`-snapshot
   - Bundle-IDs genereres ved purchase_open-flip og lagres på scheduled-game
   - BuyPopup viser timer "X sek til master starter" basert på `scheduled_start_time`

5. **Cron `openPurchaseForImminentGames` deprecates** — `MasterActionService` blir nå primær trigger; cron blir defense-in-depth fallback.

**Estimat:** 1-2 dager med 1 agent + grundig E2E-test (forutsetter B.1+B.2 ikke alene løste det).

**Hvilke filer berøres (B.3 full):**
- `apps/backend/src/game/MasterActionService.ts` (kjerne)
- `apps/backend/src/game/Game1ScheduleTickService.ts` (rolle endres)
- `apps/backend/src/routes/agentGame1Master.ts` (ny ready-to-start endpoint)
- `apps/admin-web/src/api/agent-game1.ts` (ny helper)
- `apps/admin-web/src/pages/cash-inout/*` (UI med 2-stegs flyt)
- `packages/game-client/src/games/game1/*` (lobby-subscribe + bundle-ID-håndtering)
- Tester for hele flyten

**Hvilke filer berøres (B.1+B.2 minimal):**
- `apps/backend/scripts/seed-demo-pilot-day.ts` (eller seed-fil — verifiser navn)
- `apps/backend/src/game/Game1ScheduleTickService.ts` (`openPurchaseForImminentGames` time-vindu)
- `apps/backend/src/game/MasterActionService.ts` (verifiser at den IKKE override-er purchase_open)
- Test-fil for cron-flip-flyt

**Skill-doc-protokoll for fix-PR (per playbook §2.19 IMMUTABLE):**
- Oppdater `.claude/skills/spill1-master-flow/SKILL.md` med ny 2-stegs flyt
- Legg til entry i `docs/engineering/PITFALLS_LOG.md` §3 (Spill 1 arkitektur)
- Legg til entry i `docs/engineering/AGENT_EXECUTION_LOG.md`

### Første PM-handling før kode: forensic debug-protokoll

**Ikke start implementation-agent direkte.** Ny PM skal først lage en liten evidence pack som klassifiserer hvilken root cause som faktisk gjelder. Vi har brukt for mye tid på å fikse symptomer uten å ha DB/logg/PostHog/Sentry-bevis bundet til samme test-run.

**Minimum evidence pack før B.1/B.2/B.3 velges:**

1. **Run metadata**
   - Git SHA på backend/admin-web som testes
   - Tidspunkt for siste `npm run dev:nuke -- --reset-state`
   - Plan-run id, scheduled-game id, testbruker/player id, master action timestamp
   - PostHog session-recording URL/id hvis UI var involvert
   - Sentry query baseline før og etter testen

2. **DB snapshots før master-action**
   ```sql
   SELECT id, status, current_position, business_date, started_at, finished_at
   FROM app_game_plan_run
   ORDER BY created_at DESC LIMIT 3;

   SELECT id, plan_run_id, status, scheduled_start_time, actual_start_time, actual_end_time, created_at
   FROM app_game1_scheduled_games
   ORDER BY created_at DESC LIMIT 10;
   ```

3. **DB snapshots etter master-action og etter 30 sek**
   ```sql
   SELECT status, COUNT(*)
   FROM app_game1_scheduled_games
   GROUP BY status
   ORDER BY status;

   SELECT scheduled_game_id, COUNT(*) AS purchases, MIN(purchased_at), MAX(purchased_at)
   FROM app_game1_ticket_purchases
   GROUP BY scheduled_game_id
   ORDER BY MAX(purchased_at) DESC NULLS LAST
   LIMIT 10;
   ```

4. **Backend-logg rundt samme tidsvindu**
   - `MasterActionService.start`
   - `Game1ScheduleTickService.openPurchaseForImminentGames`
   - `GamePlanEngineBridge`
   - wallet/ticket purchase errors

5. **Hypotese-matrise**

| Hypotese | Bekreftes hvis | Falsifiseres hvis | Fix-path |
|---|---|---|---|
| Seed setter `scheduled_start_time` i fortid/for tett på nå | Nyeste scheduled-game har `scheduled_start_time <= now()` eller bare sekunder frem | Start time ligger 5-10 min frem | B.1 |
| Cron/tick kjører ikke | Ingen logg fra `openPurchaseForImminentGames`, og scheduled-game blir stående `scheduled` | Cron logger og vurderer riktig row | B.2 / scheduler infra |
| Cron-condition er for snever | Cron logger, men velger ikke row som burde åpnes | Row flippes til `purchase_open` | B.2 |
| `MasterActionService.start` bypasser `purchase_open` | Status går `scheduled → running` selv om start_time er fremtidig | Status holder seg i `purchase_open` til ready-action | B.3 guard/2-stegs flyt |
| Plan-run auto-advance er separat bug | Game fullføres korrekt med purchases, men plan-run stopper på pos 1 | Plan-run går pos 1 → 2 etter completion | Separat P0 etter purchase_open |
| Klient bruker stale localStorage bundle-id | DB har gyldige bundles/purchases, men klient sender gammel id etter dev:nuke | Hard refresh/clear storage løser kjøp | Client reset UX |

**Decision gate:**
- Hvis B.1 er bekreftet: land seed-fix først, men ikke kall systemet robust før live-test viser `purchase_open`.
- Hvis B.2 er bekreftet: land cron/tick-fix og legg til test som reproduserer stale scheduled-row.
- Hvis B.3 er bekreftet: implementer 2-stegs master-flyt. Ikke prøv flere kosmetiske/frontend-fixer.
- Hvis plan-run fortsatt stopper på pos 1 etter vellykket purchase/run/completion: åpne separat P0 med egen evidence pack.

**Acceptance for P0-fixen:**
- Etter fresh reset går ny scheduled-game til `purchase_open` før engine starter.
- Minst én spiller kan kjøpe bong mens master ikke har startet trekning.
- Master kan deretter starte trekning eksplisitt.
- DB viser `purchase_open → ready_to_start/running → completed`, ikke `scheduled → running`.
- Plan-run går videre til posisjon 2, eller separat P0 er opprettet med bevis for hvorfor ikke.

**Strukturforbedring levert etter handoff-review:** `scripts/purchase-open-forensics.sh` produserer disse snapshottene til `/tmp/purchase-open-forensics-<timestamp>.md`. Bruk `npm run forensics:purchase-open -- --phase before-master` og kjør på nytt med `--phase after-master-30s --scheduled-game-id <id>` etter master-action. Da slipper ny PM å rekonstruere queries manuelt under press.

---

## 2. PR-er merget i denne sesjonen (20 stk)

| PR # | Tittel | Tema |
|---|---|---|
| #1486 | bong-design preview-side for design-iterasjon | Design-tool |
| #1487 | lobby-broadcast on natural round-end + frontend loader | Spill 1 |
| #1490 | pre-runde bong-pris viser 20 kr istedenfor 5/10/15 kr | BuyPopup bug |
| #1491 | post-round-flyt — PauseOverlay vises ALDRI etter natural round-end (§5.8) | Game1Controller gate |
| #1494 | post-round-overlay data-driven dismiss (C-hybrid, 10s) | Game1EndOfRoundOverlay |
| #1495 | §5.9 bong-design — single + triple prod-implementasjon | BuyPopup design |
| #1498 | center-top design prod-implementasjon (mockup iterasjon V) | Premie-display |
| #1500 | triple-bong group-rendering via purchaseId (Bølge 2) | Backend + types |
| #1502 | Game1BuyPopup design prod-implementasjon (kjopsmodal-mockup) | BuyPopup hoved |
| #1504 | debug-HUD + event-log skjult som default — kun ?debug=full | Klient-cleanup |
| #1506 | Game1BuyPopup pixel-perfect iterasjon 2 (premietabell øverst) | BuyPopup iter |
| #1508 | restore triple-bong preview-iterasjonene tilbake | Preview-recovery |
| #1509 | restore full single + triple-iterasjonene tilbake (BINGO-letter) | Preview-recovery |
| #1511 | IDEMPOTENCY_MISMATCH ved gjenkjøp etter avbestilling (Sentry SPILLORAMA-BACKEND-6) | Wallet fix |
| #1512 | triple-bong-rendering — color-validation + Stor-multiplier + pre-runde bundle-IDs | 3-layer fix |
| #1515 | harden knowledge controls | DevOps |
| #1516 | Stor-multiplier manglet i engine-path generateTicketAssignments | Backend fix |
| #1522 | name knowledge gate checks | DevOps |
| #1523 | dev:sync + kjopsmodal-design preview + fix tsc-blocker | DevOps |
| #1525 | permanent CI-guard mot overskriving av preview-pages-design | DevOps |
| #1527 | docs(ops): add access approval matrix | Docs |
| #1529 | harden PM automation gates | DevOps |

**Kanonisk doc oppdatert denne sesjonen:**
- `.claude/skills/buy-popup-design/SKILL.md` — 2026-05-15 IMMUTABLE design-doc med iter2-spec
- `.claude/skills/buy-popup-design/kjopsmodal-design.html` — bundlet mockup (overlever rev-hash-shuffle)
- `docs/engineering/PITFALLS_LOG.md` flere entries om design-overskriving og chunk-hashing

---

## 3. Pågående bakgrunns-prosesser ved sesjons-slutt

Disse skal IKKE drepes av ny PM uten å bekrefte de er stale:

```bash
pgrep -alf "pilot-monitor-enhanced|monitor-push-to-pm|pilot-checklist-poll"
# Forventet:
# 21768 bash scripts/pilot-monitor-enhanced.sh (P0 monitor)
# 21773 bash scripts/pilot-monitor-enhanced.sh (backend-tail subprocess)
# 21776 bash scripts/pilot-monitor-enhanced.sh (event-poll subprocess)
# 24107 bash /tmp/pilot-checklist-poll.sh (DB-state-delta-tracker)
```

**Logger:**
- `/tmp/pilot-monitor.log` — full event-log (append-only)
- `/tmp/pilot-checklist.log` — DB-state-deltas (plan-run, scheduled-game, purchases)
- `/tmp/pilot-monitor-round-N.md` — per-runde-rapporter (siste: round 8)
- `/tmp/pilot-monitor-urgent.fifo` — named pipe for P0/P1 (tail dette i ny PM-sesjon)

**Hvis du vil starte fresh:**
```bash
pkill -f "pilot-monitor-enhanced|pilot-checklist-poll"
bash scripts/start-monitor-with-push.sh   # restart hele monitoring-stacken
```

**PgHero dashbord:** `http://localhost:8080` (admin / spillorama-2026-test). Verifisert oppe.

---

## 4. Live state ved sesjons-slutt (database-snapshot 20:30)

### Plan-run
```
id=eb7cffc2-4ffb-413f-b43e-876302b24300
status=finished
current_position=1     (av 13 — kun første spill kjørt)
business_date=2026-05-15
finished_at=2026-05-15 18:17:43
```

**KRITISK obs:** Plan-run avsluttet etter posisjon 1, ikke gikk videre til posisjon 2-13. Dette er en separat bug fra `purchase_open` — sannsynligvis at `advance` ikke trigges når engine går til `completed` uten purchases, eller at GamePlanEngineBridge ikke kan starte neste posisjon.

### Stale scheduled-games (ingen action nødvendig — fra demo-seed)
```sql
SELECT COUNT(*) FROM app_game1_scheduled_games
WHERE status='scheduled' AND scheduled_start_time < now() - INTERVAL '1 hour';
-- 13 rader fra 14-15. mai 11:00 — ikke flippet til purchase_open
```

Disse er stale demo-data. Cleanup via `npm run dev:nuke -- --reset-state` ved neste session-start.

### Purchase-historikk
```sql
SELECT COUNT(*) FROM app_game1_ticket_purchases
WHERE purchased_at > now() - INTERVAL '24 hours';
-- 15 stk total — fra tidligere testing, INGEN fra dagens 20:15-runde
```

---

## 5. Sentry + PostHog status

**Sentry (org=spillorama-eq, region=de.sentry.io):**
- `SPILLORAMA-BACKEND-6` IDEMPOTENCY_MISMATCH — **RESOLVED 15:15** via PR #1511
- Ingen nye P0-issues siden 15:15
- Baseline: 0 unresolved P0 ved sesjons-slutt

**PostHog:** Ingen funnel-drops registrert. Session-recordings tilgjengelig for 18:15-runden hvis du trenger DOM-replay av buy-flow.

### Observability readiness-gate for ny PM

Før ny PM kjører live-test eller spawner implementation-agent må følgende være verifisert. Hvis ett punkt feiler, er det en P0 setup-blocker, ikke "nice to have".

| System | Verifisering | Hvorfor |
|---|---|---|
| Lokal Postgres | `PGPASSWORD=spillorama psql -h localhost -U spillorama -d spillorama -c "SELECT 1;"` | PM må kunne hente state før/etter master-action uten å vente på Tobias |
| PgHero / DB-observability | `npm run dev:nuke -- --observability` ved fresh test, deretter `http://localhost:8080` | Sakte queries/N+1/connection-spikes må sees mens bug reproduseres |
| Slow-query-log | `docker logs -f spillorama-system-postgres-1 | grep "duration:"` | Gir live DB-kall under kjøpsflyt |
| Pilot-monitor | `pgrep -alf "pilot-monitor-enhanced|monitor-push-to-pm"` + `tail -f /tmp/pilot-monitor-urgent.fifo` | P0/P1 må fanges før Tobias rapporterer dem |
| Sentry | MCP/connector query: unresolved issues siste time + sortert på frekvens | Backend/frontend exceptions må korreleres med samme test-run |
| PostHog | MCP/connector: error tracking + session recording for testvinduet | Viser hva spiller/master faktisk gjorde i UI |

**Ikke legg tokens/secrets i handoff.** Dokumenter bare at connector/env virker, hvilken org/prosjekt som ble brukt, og hvilke issue/session-id-er som hører til test-runnen.

---

## 6. Outstanding work (prioritert)

### P0 (pilot-blokker)

**Anbefalt rekkefølge:**

0. **Evidence pack + failing test først (30-60 min)** — Kjør forensic debug-protokollen i §1 og skriv ned hvilken hypotese som er bekreftet. Hvis bug-en sees 2+ ganger, test først, fix etterpå.

1. **B.1 + B.2 først hvis evidence peker dit (samme dag, 2-4 timer)** — Seed-fix + cron-flip-fix sammen. Gir umiddelbar smell-test om `purchase_open` overhodet kan trigges i live-flyt med eksisterende kode. Hvis dette fungerer end-to-end, kan vi utsette B.3.
   - Seed-fix: `scheduled_start_time = now + 5-10 min` i seed-script
   - Cron-fix: `Game1ScheduleTickService.openPurchaseForImminentGames` relakses + sjekkes
   - **Test-kriterium:** Etter `dev:nuke --reset-state` skal master se "purchase_open" innen 30s + spillere kan kjøpe bonger FØR master trykker "Start trekninger"

2. **B.3 hvis B.1+B.2 ikke holder (1-2 dager)** — Full strukturell rewrite med ny `ready-to-start`-endpoint. Beskrevet i §1.B.3 over.

3. **Plan-run auto-advance etter game-end uten purchases** — Hvorfor avsluttet plan-run etter pos 1? Sjekk om `GamePlanRunService.advanceToNext` triggers ved natural round-end. (Kan være konsekvens av purchase_open-bug, eller separat.)

### P1 (post-fix, før pilot)
3. **E2E-test for 2-stegs master-flyt** — Skriv playwright/test som verifiserer full `purchase_open → ready_to_start → running → completed` med ekte purchases mellom.
4. **Pilot-checklist for ny flyt** — Oppdater `docs/operations/PILOT_FLOW_TEST_CHECKLIST_2026-05-08.md` med 2-stegs master-flyt.
5. **Removal av stale demo-games** — Cleanup-script som kjører ved `dev:nuke --reset-state` for å unngå 13 stale `scheduled`-rader.

### P2 (nice-to-have)
6. **Konfigurerbar GAME1_PURCHASE_WINDOW_MS** — Admin kan velge mellom 1min/2min/5min/10min purchase-vindu per plan
7. **Live spillere-counter i master-konsoll** — Vis "X spillere ventet på, Y bonger solgt" mens i purchase_open
8. **Auto-flip når `minTicketsToStart` nås** — Hopp over master-bekreftelse hvis nok bonger er solgt

---

## 7. Filer ny PM bør lese FØRST (utenom denne handoff)

| Fil | Hvorfor |
|---|---|
| `docs/operations/PM_SESSION_KNOWLEDGE_EXPORT_2026-05-15.md` | Tacit knowledge fra sesjonen |
| `.claude/skills/buy-popup-design/SKILL.md` | Immutable design-spec for BuyPopup (Tobias-bekreftet 2026-05-15) |
| `docs/architecture/SPILL1_IMPLEMENTATION_STATUS_2026-05-08.md` §2.3 | Master-flyt fundament — sjekk om `purchase_open` er nevnt eller om vi går utenfor spec |
| `docs/architecture/SPILL_REGLER_OG_PAYOUT.md` §5.8 | Post-round-flyt (immutable Tobias-direktiv) |
| `docs/engineering/PITFALLS_LOG.md` §3 | Spill 1 arkitektur fallgruver |
| `apps/backend/src/game/MasterActionService.ts` | Hovedfilen som må endres for Option B |
| `apps/backend/src/game/Game1ScheduleTickService.ts` | `openPurchaseForImminentGames` — verifiser hvorfor cron ikke flipper |

---

## 8. Kommandoer ny PM trenger første time

```bash
# 1. Onboarding-gate
cd /Users/tobiashaugen/Projects/Spillorama-system
bash scripts/pm-checkpoint.sh --validate

# 2. Sjekk live-stack
curl -s http://localhost:4000/health | head -c 200
docker ps | grep spillorama

# 3. Pull main
git pull --rebase --autostash

# 4. Start monitoring (hvis ikke kjørende)
pgrep -alf "pilot-monitor-enhanced|pilot-checklist-poll"
# Hvis tom: bash scripts/start-monitor-with-push.sh

# 5. Verifiser stale demo-games
export PGPASSWORD=spillorama
psql -h localhost -U spillorama -d spillorama -c "
SELECT COUNT(*) FROM app_game1_scheduled_games WHERE status='scheduled';"

# 6. Start forensic evidence pack FØR implementation
npm run forensics:purchase-open -- --phase before-master

# 7. Fresh dev-stack hvis nødvendig
cd /Users/tobiashaugen/Projects/Spillorama-system && npm run dev:nuke -- --reset-state

# 8. Etter master-action: kjør ny forensic snapshot før implementation
npm run forensics:purchase-open -- --phase after-master-30s --scheduled-game-id <id>

# 9. Spawn Explore-agent først, ikke implementation-agent
# Scope: klassifiser B.1/B.2/B.3 med DB/logg-bevis + foreslå failing test.
```

---

## 9. Tobias-kommunikasjon — viktige momenter

### Trigger-mønster denne sesjonen
- "**3 ganger vi prøver å fikse dette**" → kritikk av iterasjons-tilnærming → bytt til strukturell fix umiddelbart
- "**det er selve poenget**" → regel-spec direktiv → IMMUTABLE, dokumenter i playbook + skill
- "**B**" → kort godkjennelse på arkitektur-valg → kjør på uten ekstra spørsmål
- "**er du i gang**" → trykk fra Tobias om at PM må produsere → start umiddelbart, ikke spørr om flere detaljer

### Tillits-signaler
- Delte Sentry-issue-detalj uten masking — antar PM forstår
- Spurte "kan du lage en komplett handoff" — tillit til at PM kan oppsummere selv
- Pivoterte fra B-implementation til handoff-skriving uten å beklage tap av kontekst

### Anti-mønster å unngå (denne sesjonen)
- **Hopp i diagnosis-konklusjon for tidlig** — Jeg pekte på service-worker cache som "rotårsak" uten å verifisere. Service-workeren har INGEN fetch-listener — den cacher ingenting. Verifisering med `grep` på `firebase-messaging-sw.js` viste at det kun er FCM push + notificationclick.
- **Antagelse av at chunks ikke ble lastet** — Chunks ER fysisk på disk med korrekt design (verifisert via `grep prizeMatrixEl public/web/chunks/*` returnerte 7 treff). Kunder kan ha stale localStorage chips (gamle bundleIDs fra før dev:nuke) som forklarer "Ingen pre-round billett" — IKKE chunk-loading-feil.

---

## 10. Skill-doc-protokoll for neste agent (Option B implementation)

Når du spawner agent for purchase_open-fix, MÅ prompten inneholde:

```markdown
## Dokumentasjons-protokoll (IMMUTABLE per playbook §2.19)

I SAMME PR som implementasjonen, oppdater følgende:

### 1. Skill: `.claude/skills/spill1-master-flow/SKILL.md`
Ny seksjon "2-stegs master-flyt (purchase_open → ready_to_start)" med:
- API-kontrakt for `/api/agent/game1/master/ready-to-start`
- State-machine diagram (scheduled → purchase_open → ready_to_start → running)
- Hvordan UI sender forskjellige actions for de 2 stegene
- Hvilke services som har endret rolle (MasterActionService primær, Game1ScheduleTickService defense-in-depth)

### 2. `docs/engineering/PITFALLS_LOG.md` §3 (Spill 1 arkitektur)
Ny entry: "purchase_open hoppes over i live-flyt — strukturell fix"
- Hva som var galt
- Hvorfor det ikke ble fanget tidligere
- Hvordan unngå å reintrodusere det

### 3. `docs/engineering/AGENT_EXECUTION_LOG.md`
Kronologisk entry:
- Branch + commits
- "Lessons learned" om hvordan state-machine-flyter må verifiseres i live test, ikke bare unit-tester

### 4. ADR
Skriv ADR-NNNN om 2-stegs master-flyt som arkitektur-mønster
- Status: Accepted
- Konsekvenser: positive (matcher regel-spec) + negative (mer kompleks UI)

Disse 4 docs er IKKE valgfrie. PM verifiserer ved PR-review; PR merger ikke uten doc-update.
```

---

## 11. Endringslogg

| Tid (UTC) | Hendelse |
|---|---|
| 08:00 | Sesjons-start, fortsetter fra forrige PM-handoff (Next Game Display). |
| 09:00-12:00 | BuyPopup design-iterasjon §5.9 single + triple + center-top (#1495, #1498, #1500). |
| 13:00-15:00 | BuyPopup prod-implementasjon (#1502), pixel-perfect iter2 (#1506), debug-HUD-hide (#1504). |
| 15:00-15:30 | Wallet IDEMPOTENCY_MISMATCH fix (#1511), 3-layer triple-bong fix (#1512), Stor-multiplier engine fix (#1516). |
| 15:30-17:00 | Preview-page-protection (#1525), bong-design-restore (#1508, #1509), knowledge-gate hardening (#1515, #1522). |
| 17:30 | Tobias rapporter "ingen endring etter 3 forsøk" — frustrasjons-signal. |
| 17:35 | Full monitoring-stack restartet: pilot-monitor-enhanced + push-daemon + checklist-poll. |
| 17:45 | Sentry + PostHog baseline-sjekk. |
| 18:00 | Auto-poll milestones aktivert per Tobias-direktiv. |
| 18:15-18:17 | Live test: scheduled_game e8c023f5 går scheduled → running → completed på 82s med 0 purchases. |
| 18:18 | Browser error: "Ingen pre-round billett med id=...:bundle:0" — strukturell bug bekreftet. |
| 18:30 | Tobias-direktiv: "Det skal være mulig å kjøpe bonger uten at master har startet". |
| 18:35 | Option B (strukturell fix) valgt. |
| 19:00-19:30 | Tobias pivot: "kan du lage komplett handoff og tekst til ny PM?" |
| 20:30 | Denne handoff + KNOWLEDGE_EXPORT skrevet. |

---

**Til nestemann:** Stemningen er **fokusert frustrasjon** — Tobias har gått gjennom 3+ design-iterasjoner i dag og funnet en fundamental arkitektur-bug. Han ER tålmodig så lenge du leverer strukturell fix (Option B), ikke patch. Start med å lese KNOWLEDGE_EXPORT for tacit knowledge, deretter spawn Plan-agent for å designe `purchase_open`-flyten. Ikke gjør cosmetic-changes uten direktiv. Master-action-service er kjernen — start der.

**Lykke til. Pilot er nær, men dette MÅ løses først.**
