# PM Session Knowledge Export — 2026-05-15

**PM:** Claude Opus 4.7 (Cowork-sesjon 2026-05-15, ~08:00-20:30 lokal tid)
**Forrige PM:** Claude Opus 4.7 (2026-05-14, DB-observability + Next Game Display)
**Sesjons-varighet:** ~12 timer aktiv (med pauser)
**Tobias-direktiv som rammet sesjonen:**
1. Fra handoff: Løs Next Game Display-bug 100% (tilbakevendende)
2. Underveis: "BuyPopup-designet må implementeres riktig én gang for alle" (efter 3 forsøk)
3. Underveis: "Det skal være mulig å kjøp bonger til neste spill uten at master har startet spillet" — STRUKTURELL regel-spec
4. Slutten: "Kan du lage en komplett handoff og tekst til ny PM?"

---

## 1. Sesjons-mandat

Forrige PM la opp at jeg skulle løse Next Game Display-bug-en. Underveis ble fokus utvidet til:

1. **BuyPopup-design rebuild** — fordi Tobias hadde et mockup som ble ignorert i tidligere fix-forsøk (#1463, #1474). Måtte bygge skill-spec som bundlet HTML-mockup overlever rev-hash-shuffle.
2. **3-layer triple-bong-fix** — Stor-multiplier manglet i 3 forskjellige engine-paths (`generateTicketAssignments` backend, `BingoEngine` rendering, pre-runde bundle-IDs).
3. **Strukturell purchase_open-bug** — Oppdaget under live test mot slutten. Spill 1 har ikke fungerende ticket-purchase-fase. Tobias pivoterte fra implementation til handoff-skriving.

Eksplisitt scope-utvidelse: "Det skal være mulig å kjøp bonger til neste spill uten at master har startet spillet. Det er selve poenget." — Tobias 2026-05-15 ~18:30.

---

## 2. Kunnskap jeg tilegnet meg (utover bare lesing)

### 2.1 Mental models om Spillorama

**A. Vite chunk-hashing kan overskrive designet etter rebuild.**
BuyPopup-koden ligger i `WinningsCalculator-<hash>.js` (dynamisk import-chunk fra Game1Controller). Hver build får ny hash. Hvis design-mockup ikke ligger som git-tracket fil utenfor build-output, kan agent overskrive uforvarende. Løsning: bundle HTML-mockup INSIDE skill-mappen som immutable referanse (`.claude/skills/buy-popup-design/kjopsmodal-design.html`).

**B. State-machine-bug kan være på TVERS av lag.**
`purchase_open`-state finnes i kode (DB-enum, state-machine, route-handlers) men ble ALDRI trigget i live-flyt fordi:
1. Cron `openPurchaseForImminentGames` kjører ikke som forventet
2. `MasterActionService.start` triggerer engine direkte (hopper over purchase_open)
3. Frontend antar at scheduled-game starter i `purchase_open` og forhåndsgenererer bundle-IDs

Resultat: Alle 3 lag har "sin egen" forventning som ikke matcher de andres. Service-worker var IKKE involvert — det var grunn til å undersøke fordi cache er det første mistanke når "stale design vises".

**C. Browser localStorage holder stale chips fra før dev:nuke.**
Når dev:nuke kjører, blir database tabula rasa men localStorage på klient-side beholder bundleIDs fra forrige session. Når klient prøver å kjøpe basert på localStorage-IDs som ikke finnes i ny database → "Ingen pre-round billett med id=..." Dette er IKKE en bug, men en UX-effekt av dev:nuke. Løses ved hard refresh + clear localStorage.

**D. Engine-flyt kan rase gjennom 75 baller på 82 sekunder.**
Når 0 purchases registrert + engine starter direkte → ingen "wait for tickets"-pause, engine trekker baller på sin maks-hastighet. 82 sek for 75 baller = ~1.1 sek per ball. Dette er korrekt teknisk atferd men feil produkt-flyt.

**E. Plan-runtime kan avslutte etter posisjon 1.**
Plan-run gikk `running → finished` ved første scheduled-game-completion, ikke avansert til posisjon 2. Hvorfor? Sannsynligvis fordi GamePlanRunService.advanceToNext ikke triggers ved natural-end uten purchases — eller fordi master.start kun lagde 1 scheduled-game i stedet for å auto-advance hele planen.

### 2.2 Tobias' kommunikasjons-signaler (live observerte)

| Signal | Tolkning | Riktig respons |
|---|---|---|
| "3 ganger vi prøver å fikse dette" | Iterasjons-trøtthet, krever strukturell tilnærming | Stop iterasjon, foreslå arkitektur-fix umiddelbart |
| "det er selve poenget" | Regel-spec direktiv | Behandle som IMMUTABLE, dokumenter i playbook + skill |
| "B" (kort svar) | Tillit + grønt lys | Gjør oppgaven uten å spørre om flere detaljer |
| "er du i gang" | Trykk for fremgang | Start arbeid og rapporter status, ikke spørr om "skal jeg" |
| Deler skjermbilder med data | Forventer PM analyserer selv | Les visual data, ikke spør "hva ser du" |
| "du må sette i gang alle overvåkningsmekanismene" | Frustrasjon over manglende real-time data | Restart hele monitoring-stacken NÅ, ikke vurder |
| "Det kom nå, det tok bare lang tid" | Aksept etter latency | Bekrefter PM-handling fungerte, gå videre uten å unnskylde latency |

### 2.3 Praktiske agent-orkestrerings-lærdommer

**Hva fungerte:**
- Spawning 4 parallelle Explore-agenter for BuyPopup chunk-analyse → fanget at chunks ER fysisk på disk
- Pilot-monitor-enhanced + pilot-checklist-poll.sh i background → ga real-time DB-deltas

**Hva feilet:**
- Initial chunk-analyse antok service-worker cache uten verifisering. Verifisering med `grep` på sw.js viste ingen fetch-listener.
- Forsøkte å fikse pilot-checklist-poll.sh med inline-bash escaping → måtte rewrite med simpler PSQL-variabel.
- Brukte feil tabell-navn (`app_compliance_audit_log` finnes ikke, det er `app_audit_log`) — kostet ~5 min.
- Brukte feil kolonne (`user_id` på purchases, det er `buyer_user_id`).

**Lærdom:** Verifiser DB-schema med `\d <tabell>` FØR du skriver queries i overvåknings-scripts.

### 2.4 Arkitektur/Spill-spesifikk innsikt

**Spill 1 state-machine forventer 4 status-overganger:**
```
scheduled → purchase_open → ready_to_start → running → completed
```

**Live data viser 2 overganger i bruk:**
```
scheduled → running → completed
```

**Konsekvens:** `purchase_open`-fasen er "dødvekt kode" — designet, validert, testet i unit-tests, men aldri kjørt i live-flyt. Dette er klassisk "code that has no live coverage" — kun fanges av E2E-test mot ekte master-flyt.

**Bridge-service GamePlanEngineBridge** opprettet scheduled-games i `ready_to_start` (ikke `purchase_open`). Antakelig fordi tidligere implementasjon valgte å hoppe over purchase_open for å unngå komplekse race-conditions. Men det betyr at backend-koden for purchase_open eksisterer uten å være nådd.

### 2.5 Live data jeg samlet inn under sesjonen

**Sentry-funn:**
- `SPILLORAMA-BACKEND-6` IDEMPOTENCY_MISMATCH — fikset i PR #1511. Var årsak til at gjenkjøp etter avbestilling feilet med 400-error.

**PostHog observations:**
- Ingen funnel-drop registrert under sesjons-testing (mest fordi få spillere testet og ingen ble dropped i tradisjonell forstand — bug-en var at de fikk Inception-error).

**Postgres-snapshots av interesse:**

```sql
-- Bevis på purchase_open-bug
SELECT id, status, actual_start_time, actual_end_time,
       EXTRACT(EPOCH FROM (actual_end_time - actual_start_time)) AS duration_sec
FROM app_game1_scheduled_games
WHERE id='e8c023f5-ad28-4673-986f-51dac4211dd7';
-- duration_sec=82.09, 0 purchases, status=completed

-- 13 stale demo-games stuck i scheduled
SELECT id, status, scheduled_start_time
FROM app_game1_scheduled_games
WHERE status='scheduled' AND scheduled_start_time < now() - INTERVAL '1 hour';
-- 13 rader, alle med scheduled_start_time = 2026-05-14/15 11:00

-- Plan-run avsluttet etter pos 1
SELECT id, status, current_position, finished_at
FROM app_game_plan_run ORDER BY created_at DESC LIMIT 1;
-- status=finished, current_position=1 av 13, finished_at right after engine done
```

**Backend-log-mønstre:**
- `master-action-service` warn-logs ved start (race-condition deteksjon)
- `db.stuck-state` P1 fra monitor: "Plan-run RUNNING men scheduled-game COMPLETED/NULL"
- Ingen `engine.error` eller `transactional-rollback` — alt så ut til å fungere på engine-siden

### 2.6 Hva må struktureres om for at debug skal gå smidigere?

**Ny PM må behandle purchase_open som en P0 incident, ikke en vanlig feature-fix.** Det betyr at første leveranse ikke er kode, men en liten evidence pack som knytter sammen samme test-run på tvers av Postgres, backend-logg, Sentry og PostHog.

**Manglende struktur som kostet tid denne sesjonen:**
- DB-snapshots, browser-observasjon og backend-logg ble analysert i ulike biter, ikke som én korrelert timeline.
- Vi manglet fast "før/etter master-action" query-sett for `plan_run`, `scheduled_games` og `ticket_purchases`.
- PostHog/Sentry ble brukt som baseline, men ikke bundlet inn som obligatorisk evidence i selve bug-classification.
- Vi hadde ingen liten forensic-runner som skriver `/tmp/purchase-open-forensics-<timestamp>.md`.

**Etter handoff-review er dette tettet:** `scripts/purchase-open-forensics.sh` finnes nå og er eksponert som `npm run forensics:purchase-open`. Ny PM skal bruke den før/etter master-action slik at evidence pack blir en fil, ikke muntlig kontekst.

**Anbefalt ny arbeidsmåte for neste PM:**
1. Kjør `npm run forensics:purchase-open -- --phase before-master` før implementation.
2. Klassifiser root cause som B.1, B.2, B.3, plan-run-separat eller client-localStorage.
3. Kjør scriptet på nytt etter master-action: `npm run forensics:purchase-open -- --phase after-master-30s --scheduled-game-id <id>`.
4. Skriv failing test som matcher klassifiseringen.
5. Først deretter spawn implementation-agent med skill-doc-protokoll.

Dette er viktig fordi Tobias' frustrasjon nå ikke handler om manglende innsats, men om manglende kausalitet: vi må kunne si "denne raden gikk ikke til purchase_open fordi X", ikke "vi tror det er cron/master/frontend".

---

## 3. Konkrete handlinger jeg gjorde

### Filer LEST direkte denne sesjonen
- `/Users/tobiashaugen/Projects/Spillorama-system/CLAUDE.md`
- `docs/operations/PM_HANDOFF_2026-05-14.md` (forrige handoff)
- `docs/operations/PM_HANDOFF_2026-05-13_PART3.md`
- `docs/operations/PM_SESSION_KNOWLEDGE_EXPORT_2026-05-14.md`
- `docs/architecture/SPILL1_IMPLEMENTATION_STATUS_2026-05-08.md` §§ 1, 2.3, 5
- `docs/architecture/SPILL_REGLER_OG_PAYOUT.md` §3 (auto-mult) + §5.8 (post-round)
- `docs/architecture/SPILL_ARCHITECTURE_OVERVIEW.md`
- `docs/engineering/PITFALLS_LOG.md` §3, §6, §7
- `docs/engineering/SKILL_DOC_PROTOCOL_TEMPLATE.md`
- `apps/backend/public/web/firebase-messaging-sw.js` (verifiserte INGEN fetch-listener)
- `apps/backend/public/web/main.js` (verifiserte loader-shape)
- `packages/game-client/src/games/game1/components/Game1BuyPopup.ts` (lest)
- `packages/game-client/src/games/game1/components/Game1BuyPopup.test.ts` (lest)
- `packages/game-client/src/kjopsmodal-design/kjopsmodal-design.html` (mockup-spec)
- `.claude/skills/buy-popup-design/SKILL.md` (skrev hele filen)
- `.claude/skills/spill1-master-flow/SKILL.md` (lastet for planning)
- `.claude/skills/intent-verification/SKILL.md` (lastet for planning)
- `apps/backend/src/game/MasterActionService.ts` (skummet for å forstå start-flyt)
- `apps/backend/src/game/Game1ScheduleTickService.ts` (verifiserte purchase_open-kode finnes)

### Filer SKREVET
- `.claude/skills/buy-popup-design/SKILL.md` — komplett immutable design-spec (2026-05-15 IMMUTABLE)
- `.claude/skills/buy-popup-design/kjopsmodal-design.html` — bundlet HTML-mockup (overlever rev-hash)
- `/tmp/pilot-checklist-poll.sh` — DB-state-delta-tracker (3 iterasjoner før korrekt)
- `docs/operations/PM_HANDOFF_2026-05-15.md` (denne sesjon)
- `docs/operations/PM_SESSION_KNOWLEDGE_EXPORT_2026-05-15.md` (denne fil)

### PR-er åpnet + merget (20 stk)
Se PM_HANDOFF §2 for komplett liste. Hovedstykker:
- #1502, #1506 — BuyPopup design prod + iter2
- #1511, #1512, #1516 — wallet + 3-layer triple-bong fixes
- #1525, #1529 — preview-guard + PM-automation-hardening
- #1486, #1495, #1498, #1500 — design-iterasjoner

### Agenter spawnet
| Agent | Type | Scope | Leveranse |
|---|---|---|---|
| Game1BuyPopup chunk-analyzer | Explore | Verifiser at design ER i chunks | Bekreftet 7× prizeMatrixEl + BONG_PALETTE i WinningsCalculator-DA8URkER.js |
| BuyPopup design-iterasjon 2 | general-purpose | Pixel-perfect mot mockup | PR #1506 levert |
| Wallet IDEMPOTENCY_MISMATCH | general-purpose | Sentry-fix | PR #1511 levert |
| Triple-bong 3-layer fix | general-purpose | Stor-mult + color-validation + bundle-IDs | PR #1512 + #1516 levert |
| Knowledge-gate hardening | general-purpose | CI-guards mot stale design | PR #1515, #1522, #1525, #1529 levert |
| Service-worker analyzer | Explore | Verifiser SW-cache-theory | Bekreftet INGEN fetch-listener — theory feil |

---

## 4. Anti-mønstre jeg oppdaget under sesjonen (slik at neste PM ikke gjentar)

### 4.1 "Hopp til diagnosis-konklusjon før verifisering"
**Hva jeg gjorde feil:** Antok Service Worker cachet stale design-chunks. Brukte 30 min på å instruere Tobias å clear cache, hard refresh, etc. uten å først lese sw.js.

**Fix:** Når du har en "cache-theory", LES SW-filen først (`Read /web/firebase-messaging-sw.js`). Hvis det ikke har `addEventListener('fetch')` cacher den ikke fetches. Verifisering tar 30 sek og sparer 30 min.

### 4.2 "Anta tabell-navn matcher canonical doc"
**Hva jeg gjorde feil:** Skrev queries mot `app_compliance_audit_log` basert på CLAUDE.md som nevner det. Tabellen finnes ikke — det heter `app_audit_log`.

**Fix:** ALLTID kjør `\dt` eller `\d <tabell>` i psql FØR du skriver queries i scripts. Auto-doc-er kan være stale, doc-en kan ha typos.

### 4.3 "Polling-script kompleksitet med eval/quotes"
**Hva jeg gjorde feil:** Første versjon av pilot-checklist-poll.sh hadde nested eval + bash-quotes som broke. Tok 3 iterasjoner å rette opp.

**Fix:** Bash-scripts for monitoring: bruk variabel for kommando-prefix (`PSQL="psql -h... -d..."`) og kall direkte. Unngå `eval` med dynamiske parametere.

### 4.4 "Lytte etter Tobias' frustrasjons-signal er kritisk"
**Hva jeg gjorde feil:** Forsto ikke umiddelbart at "3 ganger vi prøver" var en pivot-trigger. Fortsatte med iterativ feilsøking i 10 min etter signalet.

**Fix:** Når Tobias bruker tall i frustrasjon-uttrykk ("3 ganger", "flere dager", "utallige forsøk") — stop iterasjon umiddelbart, foreslå strukturell tilnærming.

### 4.5 "Ikke verifiser regel-spec mot kode FØR du foreslår fix"
**Hva jeg gjorde feil:** Da Tobias skrev "det skal være mulig å kjøp bonger uten master har startet", forsto jeg det som "frontend må kalle annet endpoint". Faktisk regel-spec krever ny state `purchase_open` med ny endpoint og UI-redesign.

**Fix:** Når Tobias gir regel-spec ("X skal være mulig"), MAP det først mot state-machine i koden. Hvis det krever ny state → arkitektur-endring, ikke bare endpoint-fix.

---

## 5. Open questions ved sesjons-slutt

1. **Hvorfor avsluttet plan-run etter pos 1?** Er det fordi `GamePlanRunService.advanceToNext` ikke trigges ved natural-end uten purchases, eller fordi `master.start` kun lager 1 scheduled-game og ikke auto-advancer hele planen? — KRITISK å forstå før Option B implementeres.

   **Tobias-spørsmål 2026-05-15 20:35:** "Har du tatt med at dette må fikses først? B) Fix purchase_open-vinduet permanent (krever PR): Seed/sett scheduled-games med start_time i framtid (5-10 min frem) eller endre cron til å flippe stale scheduled til purchase_open umiddelbart." — Disse to konkrete fix-paths må vurderes som B.1+B.2 før full strukturell rewrite (B.3). Dokumentert i PM_HANDOFF §1.

2. **Hva skal "Start trekninger nå" gjøre hvis 0 bonger solgt?** Tobias' regel sier "venter til bonger er kjøpt, deretter starter master". Men hva hvis ingen kjøper? Konfigurerbar timeout? Force-start? Hopp til neste posisjon?

3. **Frontend bundle-ID-strategi for purchase_open:** Skal bundle-IDs genereres ved purchase_open-flip (server-side) og pushes til alle klienter, eller genereres on-demand når klient prøver å kjøpe? Race-condition implikasjoner.

4. **Hvordan håndtere dev:nuke localStorage?** Bør klient detektere "ny database" og auto-clear localStorage? Eller skal vi anta at testere alltid hard-refresher?

5. **Skal stale demo-games auto-cleanes?** 13 rader fra 14-15. mai 11:00 sitter i `scheduled`. Cleanup-cron eller fix i dev:nuke --reset-state?

---

## 6. Mental hand-off — "hvis jeg var ny PM nå, hva må jeg vite?"

1. **STRUKTURELL bug:** Spill 1 har ikke fungerende `purchase_open`-fase. Engine starter direkte fra `scheduled` → `running`. Tobias har valgt Option B. **3 underveis-paths:**
   - **B.1:** Seed-fix — `scheduled_start_time = now + 5-10 min` i seed (2-4 timer)
   - **B.2:** Cron-fix — `openPurchaseForImminentGames` flipper stale `scheduled` umiddelbart (2-4 timer)
   - **B.3:** Full strukturell rewrite med ny ready-to-start-endpoint (1-2 dager)
   - **Anbefalt:** B.1+B.2 først som smell-test, B.3 kun hvis nødvendig.

2. **Første PM-handling er forensic evidence, ikke kode.** Kjør `npm run forensics:purchase-open -- --phase before-master`, trigger test, vent 30 sek, kjør `npm run forensics:purchase-open -- --phase after-master-30s --scheduled-game-id <id>`. Velg B.1/B.2/B.3 først når én hypotese er bekreftet med DB/logg/Sentry/PostHog-bevis.

3. **Tobias' direktiv 2026-05-15:** "Det skal være mulig å kjøp bonger uten master har startet. Det er selve poenget." — IMMUTABLE regel-spec.

4. **20 PR-er merget i dag** — BuyPopup design er prod, 3-layer triple-bong fix er prod, wallet IDEMPOTENCY er fikset. Pilot-blokker er KUN purchase_open-bug nå.

5. **Monitoring kjører** — pilot-monitor-enhanced (PID 21768-21776) + pilot-checklist-poll (PID 24107) + PgHero (port 8080). Skal IKKE drepes ved sesjons-start; bekreft heller med `pgrep`.

6. **Live data lokasjon:** `/tmp/pilot-monitor.log` (full), `/tmp/pilot-checklist.log` (DB-deltas), `/tmp/pilot-monitor-round-N.md` (per-runde). PgHero på http://localhost:8080.

7. **Sentry SPILLORAMA-BACKEND-6 RESOLVED** (PR #1511). Ingen aktive P0-issues. Baseline ren.

8. **Plan-run finished på pos 1** — `eb7cffc2-...` gikk til finished etter pos 1 av 13. Sannsynligvis konsekvens av purchase_open-bug, men kan være separat. Sjekk `GamePlanRunService.advanceToNext`.

9. **BuyPopup-design er nå LÅST som immutable** via `.claude/skills/buy-popup-design/SKILL.md` + bundlet HTML-mockup. Permanent CI-guard (PR #1525) forhindrer overskriving av preview-pages.

10. **Skill-doc-protokoll IMMUTABLE** (playbook §2.19) — hver fix-PR MÅ oppdatere skill + PITFALLS_LOG + AGENT_EXECUTION_LOG. PM verifiserer ved review.

11. **Tobias bruker `npm run dev:nuke` ALLTID** etter merge (playbook §2.2). Aldri selective restart. Etter Option B-merge: gi Tobias kommando `cd /Users/tobiashaugen/Projects/Spillorama-system && npm run dev:nuke -- --reset-state`.

---

## 7. Endringslogg

| Tid (UTC) | Hendelse |
|---|---|
| ~08:00 | Sesjons-start, fortsetter fra Next Game Display-handoff. |
| ~09:00 | BuyPopup design-iterasjon mockup laget av Tobias. |
| ~10:00 | Skill `.claude/skills/buy-popup-design/` opprettet med bundlet HTML. |
| ~11:00 | PR #1490 (bong-pris), #1491 (PauseOverlay-gate), #1494 (overlay-dismiss). |
| ~12:00 | PR #1495 (§5.9), #1498 (center-top), #1500 (Bølge 2 backend). |
| ~13:00 | PR #1502 BuyPopup prod-implementasjon merget. |
| ~14:00 | PR #1504 (debug-HUD), #1506 (iter2 pixel-perfect). |
| ~15:00 | PR #1508, #1509 (restore preview), #1511 (wallet), #1512 (3-layer), #1516 (Stor-mult). |
| ~16:00 | PR #1515 (knowledge-gate), #1522 (named checks), #1523 (dev:sync), #1525 (CI-guard). |
| ~17:00 | PR #1527 (access matrix), #1529 (PM-automation). |
| ~17:30 | Tobias rapporterer "3 ganger" frustrasjons-signal. |
| ~17:45 | Monitoring-stack restartet (pilot-monitor-enhanced + push + checklist-poll). |
| ~18:00 | Auto-poll milestones aktivert. |
| ~18:15-18:18 | Live test: scheduled_game e8c023f5 (82s, 0 purchases). Browser error "Ingen pre-round billett". |
| ~18:30 | Tobias-direktiv: regel-spec for purchase_open. Option B valgt. |
| ~19:00 | Forberedte Option B implementation (spawned planning). |
| ~19:30 | Tobias pivot: "kan du lage komplett handoff?" |
| ~20:30 | Denne KNOWLEDGE_EXPORT skrevet. |

---

**Til nestemann:** Du arver et **fundamentalt fungerende system med ÉN strukturell bug**. BuyPopup er pen, wallet er stabil, premier er korrekt skalert, monitoring kjører. Det eneste som mangler er at master-flyten faktisk venter på purchases før engine starter — som er HELE forretnings-poenget. Implementer Option B med skill-doc-protokoll, og pilot er klar. Tobias er fokusert men tålmodig så lenge du leverer strukturell fix, ikke patch.
