# PM-handoff — 2026-05-11 SESSION-END (komplett brief)

**PM:** Claude Opus 4.7 (AI under Tobias-koordinering)
**Status:** Sesjons-slutt med UFULLSTENDIG diagnose. **Spillerklienten kommer fortsatt ikke inn på spillet.**
**Estimert tid for neste PM:** 2-4 timer for å diagnostisere ekte rot-årsak
**Tidligere handoff i samme dag:** [`PM_HANDOFF_2026-05-11.md`](./PM_HANDOFF_2026-05-11.md) — IKKE LES denne først, les denne handoff i sin helhet

---

## ⚠️ KRITISK FOR NESTE PM

> **Tobias-direktiv 2026-05-11 ved sesjons-slutt: "kan du gi meg komplett Brief til ny PM på alt det som er prøvd slik at ny PM ikke går i de samme fellene?"**

Denne handoff er skrevet etter at vi gjennom hele dagen patchet feil dimensjon. Tobias har vært **stressed og frustrert**. Ikke gjenta:
1. Spillerklienten kommer ikke inn på spillet etter masse arbeid
2. Vi gjettet flere ganger på feil rot-årsak
3. Vi reagerte raskt med PR-er istedenfor å diagnostisere ordentlig FIRST

**Hvis du som ny PM ikke umiddelbart kan reprodusere bug → IKKE skriv kode → FÅ TOBIAS TIL Å DELE FULL KONSOLL-LOG + NETWORK-TAB FØRST.**

---

## TL;DR — Hva er problemet RUTINE

Klient kommer ikke inn på spillet. Symptom: klikker spill-kort, 0.5s loading, kommer tilbake til lobby. Konsoll viser eventuell error som vi misset i tidligere diagnose. **Den FAKTISKE konsoll-loggen ved sesjons-slutt:**

```
[GameBridge] drawNew gap detected — requesting room:state resync {got: 48, expected: 0, gapSize: 48}
[GameBridge] resync failed {ok: false, error: {...}}
[Game1Controller] plan-advance: f46ae379-1b3b-48ce-9cbc-574546cb4619 → 2b475df7-7b8d-419f-a1c5-f1d4a1aeca79, re-joining scheduled game
[Game1Controller] re-join scheduled game feilet — beholder forrige room: {code: 'ROOM_NOT_FOUND', message: 'Rommet finnes ikke.'}
```

**Ny hypotese (NOT verified):** DemoAutoMasterTickService auto-advancer plan-runtime for raskt → scheduled-game-rom blir spawnet/ødelagt i race med klient-join → `ROOM_NOT_FOUND`. Resync-pipeline kollapser. Klient ender i fallback-loop.

---

## 11 PR-er merget i denne sesjonen

I rekkefølge:

| # | PR | Hva | Status |
|---|---|---|---|
| 1 | [#1218](https://github.com/tobias363/Spillorama-system/pull/1218) | `room:resume` fallback ved `PLAYER_ALREADY_IN_ROOM` | ✅ På main, sannsynligvis trygg |
| 2 | [#1220](https://github.com/tobias363/Spillorama-system/pull/1220) | Rate-limit tier-økning | ✅ På main |
| 3 | [#1221](https://github.com/tobias363/Spillorama-system/pull/1221) | PITFALLS_LOG §7.13+§7.14+§9.7 | ✅ Doc-only |
| 4 | [#1223](https://github.com/tobias363/Spillorama-system/pull/1223) | `/api/_dev/hall-room-info` + debug-HUD + 30s timing | ✅ På main |
| 5 | [#1225](https://github.com/tobias363/Spillorama-system/pull/1225) | Auto-enable `DEMO_AUTO_MASTER_ENABLED=true` i `dev:all` | ⚠️ **SE NEDENFOR — kan være ny rot-årsak** |
| 6 | [#1226](https://github.com/tobias363/Spillorama-system/pull/1226) | Localhost-bypass + `HTTP_RATE_LIMIT_DISABLED` | ✅ På main, trygg |
| 7 | [#1227](https://github.com/tobias363/Spillorama-system/pull/1227) | Industry rate-limit research-rapport | ✅ Doc-only |
| 8 | [#1229](https://github.com/tobias363/Spillorama-system/pull/1229) | Per-user keying + X-RateLimit-* headers | ❌ **REVERTERT via #1235** |
| 9 | [#1230](https://github.com/tobias363/Spillorama-system/pull/1230) | Redis response-cache for stille read-endpoints | ❌ **REVERTERT via #1235** |
| 10 | [#1231](https://github.com/tobias363/Spillorama-system/pull/1231) | Klient polling quick-wins | ❌ **REVERTERT via #1235** |
| 11 | [#1234](https://github.com/tobias363/Spillorama-system/pull/1234) | PM-handoff + PITFALLS_LOG §9.8 | ✅ Doc-only |
| 12 | [#1235](https://github.com/tobias363/Spillorama-system/pull/1235) | Revert #1229+#1230+#1231 | ✅ På main |

**Current main:** `1dd69282 revert: PR #1229 + #1230 + #1231 (#1235)`

---

## Hva vi FEILDIAGNOSTISERTE under sesjonen

Vi gjettet 3 ganger og bommet på rot-årsaken:

### Gjetning 1 — Rate-limit tier-økning (PR #1220)
**Hypotese:** Spillere kastes ut etter 4 refresh fordi rate-limit-tier er for stramt. Økte limits.
**Reelt utfall:** Ikke nok — patches bet ikke. Nye fixes virket helt enkelt ikke.

### Gjetning 2 — Per-IP rate-limit anti-pattern (PR #1229 + #1230 + #1231)
**Hypotese:** Per-IP rate-limit kollapser i prod (NAT-pool) → bytt til per-user keying + Redis cache + klient quick-wins.
**Reelt utfall:** Klienten kom IKKE inn på spillet etter merge. Vi trodde det var en regresjon i en av de tre PR-ene. Spawnet 3 diagnose-agenter:
- Agent 1: PR #1231 frikjent (kodepathene identisk)
- Agent 2: PR #1229 mistenkt for bucket-key-format-endring
- Agent 3: Backend ALLEREDE på revert-kode → kunne ikke reprodusere

**Reelt funn (NÅ, etter revert):** Konsoll-error viser at problemet IKKE er rate-limit eller per-user-keying. Det er **plan-advance + ROOM_NOT_FOUND** i Game1Controller.

### Gjetning 3 — Service Worker cached stale klient-JS
**Hypotese:** Service Worker holder gammel klient-state etter revert.
**Reelt utfall:** Tobias clear-et site data + Service Worker. Samme problem.

---

## Hva som ER bekreftet å fungere

1. ✅ Backend kjører på port 4000
2. ✅ Postgres + Redis OK
3. ✅ Alle API-endpoints returnerer 200 ved curl med ekte token (testet ved sesjons-slutt)
4. ✅ Hall-default ER isolert i `demo-default-goh` (DB-verifisert)
5. ✅ `DEMO_AUTO_MASTER_ENABLED=true` aktiveres automatisk i `dev:all`
6. ✅ Klient KOBLER TIL spillet (loggen viser `[GameBridge]` events kommer inn)
7. ✅ Klient KOBLER TIL et scheduled-game (`f46ae379-...` første gangen)
8. ✅ Master eller auto-master TREKKER baller (drawIndex økte fra 48 til 51)

## Hva som IKKE fungerer

1. ❌ Klient er på et ad-hoc-rom (createRoom-fallback) men master trekker på scheduled-game-rom
2. ❌ `[GameBridge] drawNew gap detected` — klient får draws fra et rom den ikke er i, drawIndex 48 vs forventet 0
3. ❌ `requestResync` feiler (`resync failed {ok: false}`)
4. ❌ Plan-advance trigger ny scheduled-game (`2b475df7-...`) men `joinScheduledGame` returnerer `ROOM_NOT_FOUND`
5. ❌ Klient ender i loop: får draws → gap → resync feiler → plan-advance → re-join feiler → samme state

---

## ROT-ÅRSAKS-HYPOTESE (verifisert IKKE)

**Mest sannsynlig:** `DemoAutoMasterTickService` spawner scheduled-game for raskt eller racer mot klient-join. Når master `engine.startGame()` skjer, har klient ennå ikke joinet det canonical room. Når klient prøver `joinScheduledGame`, har `engine.createRoom()` enten ikke vært ferdig eller den er allerede fjernet i en cleanup-cyklus.

**Konkret hypotese:**
1. Klient joiner ad-hoc room ved createRoom (lobby-fallback fordi `nextScheduledGame=null` ved klient-last)
2. Auto-master spawner scheduled-game `f46ae379-...` → engine.createRoom → DB-rad insert
3. Master kaller `Game1MasterControlService.startGame()` → auto-tick begynner trekke baller
4. Klient ser draws via socket-broadcast men HAR IKKE JOINET dette rommet
5. Klient prøver delta-watcher join (line 974 i Game1Controller) → engine.joinRoom → ROOM_NOT_FOUND
6. Plan-advance trigger igjen for spilleplan-position++
7. Auto-master spawner NY scheduled-game `2b475df7-...` → samme race

**Mistenkt fil:** `apps/backend/src/game/DemoAutoMasterTickService.ts` — kanskje tick-intervallet er for tight, eller `Game1MasterControlService.startGame()` skjer FØR klient har joinet.

---

## KRITISK: Hva neste PM IKKE skal gjøre

1. **IKKE skriv kode før du har reprodusert bug-en lokalt med konkrete steg**
2. **IKKE patche basert på gjetning** — vi har gjort det 3 ganger og bommet
3. **IKKE anta at konsoll-log er tom** — Tobias delte først en truncated log, så delte han full log som avslørte ekte feil
4. **IKKE revert flere PR-er uten å verifisere effekt på Tobias' klient først**
5. **IKKE re-implementere per-user-keying eller Redis-cache nå** — det er ikke rot-årsaken, og PR-en kollapser dev-flyten

---

## Hva neste PM SKAL gjøre (i rekkefølge)

### Steg 1 — Be Tobias om EKSAKT info (15 min)

Send Tobias akkurat dette:

```
Kan du dele:
1. Full konsoll-log fra Cmd+Option+I → Console når du klikker spill-kort
   (særlig alt etter "Service worker registered" og GameBridge-events)
2. Network-tab: status-koder for /api/games/spill1/lobby?hallId=hall-default
   og socket-handshake (Cmd+Option+I → Network → filter "lobby" og "socket")
3. Backend-loggen i terminalen — særlig "[demo-auto-master]" og
   "[Game1MasterControlService]" og "[engine]" events fra siste 30 sek
```

### Steg 2 — Sjekk DB-state ved sesjons-start (10 min)

```bash
PGPASSWORD=spillorama psql -h localhost -U spillorama -d spillorama -c "
SELECT id, status, master_hall_id, scheduled_start_time, actual_start_time, actual_end_time, created_at
FROM app_game1_scheduled_games
WHERE master_hall_id='hall-default'
ORDER BY created_at DESC LIMIT 10;"
```

Sjekk om det er en cascade av cancelled/completed scheduled-games. Hvis ja → auto-master spawner for raskt.

### Steg 3 — Sjekk DemoAutoMasterTickService timing (15 min)

`apps/backend/src/game/DemoAutoMasterTickService.ts`:
- Hvor ofte tikker den? (Sjekk `intervalMs` i index.ts:2540 — 10000ms)
- Spawner den ny scheduled-game per tick? (Sjekk start-betingelser)
- Har den race-betingelser med klient-join?

### Steg 4 — Reprodusering (30 min)

Åpne `/web/?dev-user=demo-pilot-spiller-1&debug=1` med DevTools åpen.
Sjekk:
- Socket-events i Network-tab
- Console for `[GameBridge]` + `[Game1Controller]` events
- Backend-logg parallelt for å se room-create/destroy

### Steg 5 — Hypotese-validering før kode (15 min)

Hypotesen om DemoAutoMasterTickService kan testes ved:
1. Disable auto-master: `DEMO_AUTO_MASTER_ENABLED=false npm run dev:all`
2. Manuelt: logg inn som master-agent (`tobias-arnes@spillorama.no` / `Spillorama123!`) på `/admin/agent/cash-in-out`
3. Klikk "Start neste spill" manuelt
4. Sjekk om spillerklient kommer inn

**Hvis spiller kommer inn ved manuell master → auto-master har race**
**Hvis spiller IKKE kommer inn → noe annet er broken**

### Steg 6 — Implementer fix BARE etter validering

---

## Detaljer om dagens 11 PR-er

### Trygge PR-er (kan stå)

- **#1218** `room:resume`-fallback — verifisert via klient-test tidligere i sesjonen. Klient håndterer `PLAYER_ALREADY_IN_ROOM` korrekt nå
- **#1220** Rate-limit tier-økning — defense-in-depth, hjelper i prod
- **#1221** PITFALLS_LOG-doc — kun dokumentasjon
- **#1223** `/api/_dev/hall-room-info` + debug-HUD + 30s timing — verifisert at hall-default ER isolert
- **#1226** Localhost-bypass + `HTTP_RATE_LIMIT_DISABLED` — funker for dev
- **#1227** Industry research-rapport — kun dokumentasjon

### Mistenkt PR (verifiser hvis problem fortsetter)

- **#1225** Auto-enable `DEMO_AUTO_MASTER_ENABLED=true` i `dev:all`
  - **Mistanke:** Hvis bug-en fortsetter etter revert + Service Worker clear, kan PR #1225 være rot-årsaken. DemoAutoMasterTickService racer mot klient-join. **Test:** Sett `DEMO_AUTO_MASTER_ENABLED=false` manuelt og se om klient kommer inn.

### Revertert PR-er

- **#1229** Per-user keying — revertert. **Ikke re-implementer før neste PM har diagnostisert ekte problem.** Hvis ny PR: må ha CORS `Expose-Headers` + bucket-key-migrasjon med backwards-compat.
- **#1230** Redis response-cache — revertert. Trygg å re-implementere etterpå men ikke prioritert.
- **#1231** Klient polling quick-wins — revertert sammen med andre. Diagnose-agent frikjent denne. Kan re-implementere når plan-advance-bugen er løst.

---

## Pilot-status

**Pilot er IKKE klar:**
- Spillerklienten kommer ikke inn på spillet — ABSOLUTTE pilot-blokker
- Vi vet ikke ennå om bug-en eksisterer i prod (kan være lokal-dev-spesifikk pga DEMO_AUTO_MASTER) eller om den vil ramme reelle haller

**Pilot-tiltak status (uendret fra forrige handoff):**
- R1-R12: alle grønne som tidligere, ingen endret i denne sesjonen
- Rate-limit-fundament: PR #1229+#1230+#1231 er revertert — vi har ikke arkitektonisk fiksing fundamentet ennå

---

## Filer endret i denne sesjonen (på main)

### På main (etter revert)

- `apps/backend/src/middleware/httpRateLimit.ts` (lokal + bypass)
- `apps/backend/src/routes/devHallRoomInfo.ts` (NY)
- `apps/backend/src/index.ts` (debug-route + DEMO_AUTO_MASTER + cache-route revertert)
- `apps/backend/src/game/DemoAutoMasterTickService.ts` (timing 3→30s)
- `packages/game-client/src/games/game1/Game1Controller.ts` (debug-HUD + room:resume fallback)
- `scripts/dev/start-all.mjs` (DEMO_AUTO_MASTER_ENABLED + HTTP_RATE_LIMIT_DISABLED)
- `docs/research/RATE_LIMITING_INDUSTRY_RESEARCH_2026-05-11.md` (NY)
- `docs/engineering/PITFALLS_LOG.md` (§7.13, §7.14, §9.7, §9.8 lagt til)
- `docs/operations/PM_HANDOFF_2026-05-11.md` (FØRSTE handoff — utdatert!)

### Slettet (via revert)

- `apps/backend/src/middleware/httpResponseCache.ts` + tester
- Per-user-keying-kode i `httpRateLimit.ts`
- Klient quick-wins i `lobby.js`, `spillvett.js`, `panels.js`, `pendingDepositReminder.js`

---

## Meta-lærdom fra denne sesjonen

**Tobias-direktiv (gjentatt i sesjonen):**
> "Vi er nødt til å angripe dette på en annen måte nå. ingenting av det som blir gjort har noen effekt."

Vi lærte dette tre ganger, og hver gang gjettet vi ny rot-årsak uten å reprodusere bug konkret. Riktig framgangsmåte:

1. **Reproduser bug FØR du gjetter** — Tobias' første konsoll-log var sannsynligvis truncated. Vi skulle ha bedt om FULL konsoll + Network-tab umiddelbart.
2. **IKKE patche på samme akse mer enn én gang** uten å validere effekt
3. **Stol IKKE på agent-rapporter blindt** — agent 2 sa "Redis-cache er ikke skyldig" basert på kode-analyse. Vi visste ikke om det var sant før vi reverterte. Agent-rapporter er hypoteser, ikke beviser.

---

## Avsluttende status — sannferdig

- Sesjonen har vært produktiv på dokumentasjon + research, men **klienten kommer fortsatt ikke inn på spillet**
- Vi har en KONKRET feil-melding i konsollet nå (`ROOM_NOT_FOUND` + plan-advance loop) som vi IKKE rakk å diagnostisere før sesjons-slutt
- Neste PM må starte med Steg 1-6 over

**Hvis pilot står på spill og du må fikse RASKT:** disable DemoAutoMasterTickService (PR #1225 revert) og test om manuell master-flow fungerer. Det er ikke en permanent fix men bekrefter/avkrefter hypotesen om at auto-master er rot-årsaken.

**God lykke. Beklager kvaliteten på sesjons-leveransen.**

---

*Generated 2026-05-11 etter Tobias-direktiv ved sesjons-slutt.*
