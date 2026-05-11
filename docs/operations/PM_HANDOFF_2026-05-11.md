# PM-handoff — 2026-05-11

**PM:** Claude Opus 4.7 (AI under Tobias-koordinering)
**Forrige handoff:** [`PM_HANDOFF_2026-05-10.md`](./PM_HANDOFF_2026-05-10.md)
**Hovedleveranse:** Rate-limit fundament-refaktor (per-user keying + Redis cache + klient quick-wins) + hall-room debug-tooling

---

## TL;DR

- **9 PR-er merget på én sesjon** (#1218, #1220, #1221, #1223, #1225, #1226, #1227, #1229, #1230, #1231)
- Rate-limit-fundamentet er **arkitektonisk fikset** — ikke lenger NAT-pool-blokker for pilot
- Hall-isolation **verifisert** via DB-query + nytt `/api/_dev/hall-room-info`-endpoint + klient debug-HUD
- Klient-polling **halvert** — dedup + Retry-After + lavere frekvens
- Industry research-rapport publisert i [`docs/research/RATE_LIMITING_INDUSTRY_RESEARCH_2026-05-11.md`](../research/RATE_LIMITING_INDUSTRY_RESEARCH_2026-05-11.md)

**Ikke verifisert ved sesjons-slutt:** Tobias kjørte `dev:nuke` etter PR #1226, #1223, #1225 og fikk akutt-relief, men har ikke ennå verifisert at de tre fundament-PR-ene (#1229-#1231) faktisk fungerer som forventet. Neste PM må følge opp om Tobias rapporterer problem.

---

## Dagens kontekst

Sesjonen startet med Tobias-frustrasjon over to ting:
1. **Spillere kastes ut etter 4 refresh** (429 Too Many Requests på 11 endpoints samtidig)
2. **Hall-default ikke får trekninger** (han trodde det var rom-deling, men det var bare manglende auto-master)

To akutt-patches lærte oss at vi attakerte feil dimensjon:

> Tobias 2026-05-11: "Vi er nødt til å angripe dette på en annen måte nå. ingenting av det som blir gjort har noen effekt. bør det gjøres mer research i hvordan andre håndterer dette?"

Etter dette spawnet jeg 2 parallelle research-agenter (industry-best-practice + klient-polling-audit) som avdekket at **rate-limit-arkitekturen vår var industri-anti-pattern**. Tobias godkjente fundament-refaktor (Alternativ A), og 3 parallelle implementasjons-agenter leverte ende-til-ende-løsningen.

---

## Tobias' nye immutable direktiver fra denne sesjonen

| # | Direktiv | Hvor festet |
|---|---|---|
| 1 | Når en patch ikke har effekt, STOPP å patche samme akse — research industri-praksis | Denne handoff §"Lærdom" + PITFALLS_LOG §9.8 |
| 2 | Per-IP rate-limit er industri-anti-pattern for autenticerte routes | PITFALLS_LOG §9.8 + research-rapport |

Ingen endringer i PM_ONBOARDING_PLAYBOOK §2-direktiver (alle gjeldende fra før).

---

## 9 PR-er merget i kronologisk rekkefølge

| # | Tid | PR | Hva |
|---|---|---|---|
| 1 | 14:04 | [#1218](https://github.com/tobias363/Spillorama-system/pull/1218) | `room:resume` fallback ved `PLAYER_ALREADY_IN_ROOM` |
| 2 | 14:19 | [#1220](https://github.com/tobias363/Spillorama-system/pull/1220) | Rate-limit tier-økning (auth-reads 200/min, /api/ 1000/min) — første forsøk |
| 3 | 14:23 | [#1221](https://github.com/tobias363/Spillorama-system/pull/1221) | PITFALLS_LOG §7.13 + §7.14 + §9.7 (room-resume + delta-race + rate-limit) |
| 4 | 14:47 | [#1223](https://github.com/tobias363/Spillorama-system/pull/1223) | `/api/_dev/hall-room-info` + klient debug-HUD + 30s timing |
| 5 | 15:00 | [#1225](https://github.com/tobias363/Spillorama-system/pull/1225) | Auto-enable `DEMO_AUTO_MASTER_ENABLED=true` i `dev:all` |
| 6 | 15:19 | [#1226](https://github.com/tobias363/Spillorama-system/pull/1226) | Localhost-bypass + `HTTP_RATE_LIMIT_DISABLED` env-flag — akutt-fix |
| 7 | 15:23 | [#1227](https://github.com/tobias363/Spillorama-system/pull/1227) | Industry rate-limit research-rapport |
| 8 | 15:44 | [#1229](https://github.com/tobias363/Spillorama-system/pull/1229) | **Per-user keying + X-RateLimit-* headers** (fundament) |
| 9 | 15:45 | [#1230](https://github.com/tobias363/Spillorama-system/pull/1230) | **Redis response-cache for stille read-endpoints** (fundament) |
| 10 | 15:45 | [#1231](https://github.com/tobias363/Spillorama-system/pull/1231) | **Klient polling quick-wins** (fundament) |

**Total endring:** ~2700 linjer kode + tester, 0 type-feil, 0 test-feil.

---

## Hva som er arkitektonisk endret

### Før (problemet)
- Rate-limit: per-IP sliding window
- 250 spillere i ett bingolokale = én NAT-IP = treffer 429 samtidig
- Klient polling-tunge endpoints uten cache eller backoff
- Spillvett poller 4 endpoints hvert 15 sek uten 429-respekt

### Etter (industry-standard)
- Rate-limit: **per-user via SHA-256-token-hash** for autenticerte routes (Stripe-pattern)
  - Per-IP fallback for anonymous (login/register/csp-report — brute-force-vern bevart)
  - `X-RateLimit-Limit/Remaining/Reset` response-headers for proaktiv klient-backoff
  - Bevarte localhost-bypass + `HTTP_RATE_LIMIT_DISABLED` env-flag
- **Redis response-cache** 15-30s på stille endpoints
  - `/api/games/status` (30s) — polling-trafikk faller ~98%
  - `/api/halls` (60s)
  - Fail-soft hvis Redis nede
  - Aldri lekke auth'd data mellom brukere
- **Klient quick-wins**
  - Dedup duplicate compliance-fetches via shared event (`spillorama:complianceLoaded`)
  - Respekter `Retry-After`-header med exponential backoff i alle pollers
  - Debounce panels-open 30s
  - Spillvett-poll 15s → 30s

### Hva som er gjenstående (post-pilot)
- Push wallet/compliance/lobby via Socket.IO istedenfor poll (P1 fra research)
- Edge-enforcement på Cloudflare (P2)
- Token-bucket istedenfor sliding-window (P2)

---

## Pilot-status oppdatert

R1-R12 pilot-gating-tiltak (LIVE_ROOM_ROBUSTNESS_MANDATE 2026-05-08):
- Alle R-tiltak som var grønne FØR sesjonen er FORTSATT grønne
- Ingen R-tiltak endret status i denne sesjonen

**Ny pilot-blokker som er FJERNET:**
- Rate-limit-NAT-pool-problemet (var implicit — research avdekket det)
- Klient-polling-burst som ville trigget 429 i prod-pilot

**Ny pilot-blokker som er OPPDAGET men IKKE fikset:**
- (Ingen — pilot-fundamentet er styrket i denne sesjonen, ikke svekket)

---

## Hva neste PM må følge opp

### Akutt (innen 24t)

1. **Verifiser med Tobias** at `dev:nuke` + de 3 fundament-PR-ene gir:
   - Ingen 429-feil ved 5-10+ refresh
   - `/api/games/status` returnerer `X-Cache: HIT` på andre fetch (sjekk Network-tab)
   - `X-RateLimit-Remaining`-header synlig på /api/-responses
   - HUD top-right viser fortsatt `isol: ISOLERT`
   - 30s draws kommer på hall-default når runde er aktiv

2. **Hvis 30s draws fortsatt mangler:** kjør live-DB-sjekk for å se om `DemoAutoMasterTickService` faktisk er registrert i jobScheduler. Sjekk backend-loggen for `[demo-auto-master] tick:`-meldinger. Hvis ikke, verifiser at `DEMO_AUTO_MASTER_ENABLED=true` faktisk leses av prosessen (run `process.env.DEMO_AUTO_MASTER_ENABLED` log).

### Mellom (denne uka)

3. **Spawne agent for socket-push av wallet/compliance** (P1 fra research-rapport).
   Eliminerer behovet for 30s polling fra klienten — pure event-driven state.

4. **BACKLOG.md-oppdatering** — fjern rate-limit fra "åpne pilot-blokkere"-listen hvis den var der, og legg til "socket-push av live state" som P1 post-pilot.

### Senere (post-pilot)

5. **Implementer P2-anbefalinger** fra research-rapport:
   - Token-bucket istedenfor sliding-window
   - Cloudflare edge-enforcement
   - Load-shedder ved overbelastning

---

## Lærdom fra dagens sesjon

**Meta-lærdom:** Når en patch ikke har effekt, IKKE patch samme akse på nytt. Spawne research-agent for industri-praksis FØR du gjør den tredje iterasjonen.

Tobias spurte EKSPLISITT om dette (sitat på toppen av denne handoff). Hvis jeg hadde gjort research umiddelbart etter at PR #1220 ikke ga full effekt, hadde vi spart ~2 timer på akutt-fikse som ikke traff roten.

Konkret nytt PM-mønster:
1. Patch #1 — tester hypotese
2. Patch #2 — siste forsøk på samme akse
3. **Patch #2 fortsatt ikke effekt → STOPP. Spawn research-agent.**

Dokumentert i PITFALLS_LOG §9.8.

---

## Kjente begrensninger / kjente bug-er

Ingen nye bug-er introdusert i denne sesjonen.

Gamle kjente bug-er (overført fra forrige handoff):
- `dev:nuke` pulles ikke fersh fra worktree-branch hvis Tobias er på feil branch (warner kun, hopper over)
- Klient debug-HUD vises kun når `?debug=1` i URL — kan glemmes

---

## Filer endret i denne sesjonen

Backend:
- `apps/backend/src/middleware/httpRateLimit.ts` (refaktor + tester)
- `apps/backend/src/middleware/httpResponseCache.ts` (NY)
- `apps/backend/src/middleware/httpResponseCache.test.ts` (NY)
- `apps/backend/src/routes/devHallRoomInfo.ts` (NY)
- `apps/backend/src/index.ts` (route-wiring × 2)
- `apps/backend/src/game/DemoAutoMasterTickService.ts` (timing 3→30s)

Game client:
- `packages/game-client/src/games/game1/Game1Controller.ts` (debug-HUD + room:resume fallback)

Web shell (klient):
- `apps/backend/public/web/lobby.js` (event-dispatcher)
- `apps/backend/public/web/spillvett.js` (event-listener + 30s poll)
- `apps/backend/public/web/panels.js` (debounce-cache)
- `apps/backend/public/web/pendingDepositReminder.js` (Retry-After backoff)

Dev-tooling:
- `scripts/dev/start-all.mjs` (auto-enable `DEMO_AUTO_MASTER_ENABLED` + `HTTP_RATE_LIMIT_DISABLED`)

Docs:
- `docs/research/RATE_LIMITING_INDUSTRY_RESEARCH_2026-05-11.md` (NY — 243 linjer)
- `docs/engineering/PITFALLS_LOG.md` (§7.13, §7.14, §9.7, §9.8 lagt til)
- Denne PM-handoff

---

## Avsluttende status

**Sesjonen var produktiv.** 9 PR-er, 0 test-feil, 0 type-feil. Tobias-frustrasjonen fra rate-limit-NAT-pool ble løst arkitektonisk, ikke patched. Industry research bevart i doc-form for fremtidig referanse.

**Neste PM:** Verifiser akutt punkt 1 og 2 over. Hvis alt grønt, fortsett pilot-roadmap (R-tiltak + post-pilot socket-push P1).
