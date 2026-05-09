# PM-handoff 2026-05-09: Spill 1 master-flyt KOMPLETT — spillerklient-rebuild GJENSTÅR

**Forrige PM-handoff:** [docs/operations/PM_HANDOFF_2026-05-07.md](./PM_HANDOFF_2026-05-07.md)
**Sist oppdatert:** 2026-05-09 22:45 av Claude (PM-AI Sonnet 4.5) i samarbeid med Tobias Haugen
**Branch / commit på main:** `d09fe5a4` (sist pulled — ingen nye commits etter sist PM-handoff lokalt)
**Sesjons-status:** Tobias er **veldig sliten** etter ~12-timers feilsøking. Pilot er **NÆR** men spillerklient mangler kobling til plan-runtime — kritisk neste blokker.

---

## 🚨 LES FØRST hvis du er ny PM

Tobias Haugen er teknisk lead. Han ga eksplisitt direktiv ved sesjons-slutt:

> "Vitkig at du skriver komplett handoff så alt kontekst og kunnskap du har opparbeidetet bringes videre til ny PM. Det er også ekstresmt vitkgi at alt som er gjort blir grundig dokuemntert. Dette vil være avgjørende for at vi skal klare å drive dette prosjktet videre eller ikke. pr nå står vi litt fast"

**Følg disse reglene:**

1. **Les denne handoff fra topp til bunn FØR du gjør noen kode-endring.**
2. **Sjekk Tobias' fundamentale direktiver i seksjon §2** før du foreslår arkitektur-endringer.
3. **Tobias kjører ALDRI git lokalt.** Du må `git pull` i hovedrepoet etter hver PR-merge. Hot-reload tar resten — Tobias bare refresher nettleseren.
4. **Backend kjører på port 4000** (eller 4001 hvis 4000 er tatt). Sjekk med `lsof -nP -iTCP:4000,4001 -sTCP:LISTEN`.
5. **Spillerklient-rebuild er neste store oppgave.** Den krever ny sesjon med dedikert agent-team. IKKE start på den før du har full kontekst.

---

## Tl;dr — Sesjonens deliverables

### ✅ Det som FUNGERER nå (test-validert via curl + DB)

1. **Master cash-inout dashboard** (`/admin/agent/cashinout`) — Master-handlinger + hall-pillene rendres korrekt
2. **Mark-ready uten gameId** — backend lazy-spawner scheduled-game (status=scheduled, IKKE running)
3. **Sub-haller kan markere klar** — binder seg til samme scheduled-game som master spawnet
4. **Master kan starte spill** — engine bruker eksisterende scheduled-game (idempotent)
5. **DrawScheduler auto-restart blokkert** for `bingo`-slug (Spill 1 = master-styrt)
6. **"Ekskludert"-pille viser kun ved faktisk ekskludering** (ikke ved 0 spillere)
7. **`master_hall_id` permanent satt** på `demo-pilot-goh` via seed-fix

### 🚫 Det som GJENSTÅR (pilot-blokker — NESTE SESJON)

**Spillerklient er ikke koblet til plan-runtime.** Når en spiller åpner Spill 1:
- Viser hardkodet "STANDARD" som spill-navn (skal være "Bingo" fra `lobby.planMeta.catalogDisplayName`)
- Auto-countdown uten master-trigger (skal vente på master)
- Etter "0" → bare "..." (degradert state)
- 8 bongfarger (skal være 3 per spec — se SPILL_REGLER_OG_PAYOUT.md)

Detaljer i seksjon §6 (Plan for neste sesjon).

### 📊 Tilstand-tabell

| Komponent | Status |
|---|---|
| Backend lazy-spawn av scheduled-game | ✅ MERGET LOKALT (ikke pushet til main ennå) |
| Cash-inout master-knapp + ready-knapper | ✅ MERGET LOKALT |
| DrawScheduler kill-switch for bingo | ✅ MERGET LOKALT |
| `master_hall_id` permanent fix i seed | ✅ MERGET LOKALT |
| `.env` korrigert til Docker-Postgres | ✅ MERGET LOKALT (filen ikke i git) |
| Spillerklient ↔ plan-runtime kobling | ❌ GJENSTÅR (neste sesjon) |
| BongCard farge-paritet (3 farger) | ❌ GJENSTÅR |
| NextGamePanel (`/admin/agent/games`) mark-ready | ❌ Buggy — skriver ikke til DB (separat fra cash-inout) |

---

## §1 — Sesjons-kontekst (hvordan vi havnet her)

Tobias hadde tidligere på dagen vært i en lang sesjon (24+ PR-er merget) hvor pilot-flyten ble bygd opp. Mot slutten oppdaget han at **master ikke kunne starte spill fra cash-inout** — knappene manglet helt. Etter en lang frustrasjon-fase ("hvorfor klarer vi ikke å få kontroll på dette?") ble denne sesjonen åpnet for å fikse master-flyten.

**Initial diagnose:** Tobias' lokale `apps/backend/.env` pekte på `tobiashaugen@localhost:5432/spillorama_local` (en lokal Postgres uten passord) i stedet for Docker-Postgres på `spillorama:spillorama@localhost:5432/spillorama`. Det forklarte hvorfor login feilet med 500 INTERNAL_ERROR i flere timer.

Etter `.env`-fix kom flere lag av bugs frem:

1. `master_hall_id` på `demo-pilot-goh` var NULL → `isMasterAgent: false` → master-knapper aldri rendret
2. UI rendret kun master-knappen når en scheduled-game allerede eksisterte → master kunne aldri spawne første runde
3. DrawScheduler auto-startet runder for boot-bootstrap-rom → "spill running uten å starte"
4. Mark-ready krevde gameId → kunne ikke markere klar før master hadde startet → motstrid med Tobias' direktiv
5. UI viste "Ekskludert" når `hasNoCustomers=true` (alle haller når ingen spillere koblet) — bug i tolkning

Hver av disse er fikset (detaljer i §3).

---

## §2 — Tobias' fundamentale direktiver (memorere dette)

Disse er gjennomdiskutert med Tobias og er IMMUTABLE inntil han eksplisitt sier annet:

### §2.1 Master starter spillet — alle haller markerer klar FØR

> "Alle haller skal markere seg som klar og deretter skal master starte spillet når da alle er klare. Man starter ikke spillet og så venter man på at hallene skal markere seg som klar." — Tobias 2026-05-09

**Konsekvens for arkitektur:**
- Mark-ready må kunne kalles UTEN at master har trykket Start (lazy-spawn av scheduled-game)
- Plan-runtime må støtte "preparing"-state (vi har valgt: scheduled-game lever i `status=scheduled` mens vi venter på engine-start)
- UI skal ikke kreve at noen runde er aktiv før mark-ready-knappene er klikkbare

### §2.2 Master kan starte UAVHENGIG av om alle er klare

> "Master kan starte/stoppe **uavhengig** av om andre haller er klare" — Tobias 2026-05-08

**Konsekvens:**
- Ready-status er KUN informativ
- Hvis noen ikke er klare når master klikker Start → de ekskluderes fra runden (auto)
- UI viser bekreftelses-popup med antall ikke-klare haller, men master kan fortsette

### §2.3 Spillerklient skal ALDRI vise andre views enn neste planlagte spill

> "Når man kommer inn i spill 1 som kunde så skal man alltid da se neste spill som er planlagt. Dette spillet skal da starte når master har trykket på knappen. Det skal aldri være noen andre views i det live rommet en neste planlagte spill." — Tobias 2026-05-09

**Konsekvens for spillerklient (det som GJENSTÅR):**
- Spillerklient må hente plan-meta fra aggregator (`lobby.planMeta.catalogDisplayName`)
- Ingen lokal countdown-logikk — vente på master-trigger
- Ingen fallback-views ("...") — alltid neste planlagte spill
- BongCard skal bruke spec-konforme farger (3 farger: hvit/gul/lilla) ikke 8

### §2.4 Spill 1 = master-styrt — IKKE auto-restart

Per [SPILL1_IMPLEMENTATION_STATUS_2026-05-08.md](../architecture/SPILL1_IMPLEMENTATION_STATUS_2026-05-08.md) §5.2:
- Spill 1 har INGEN perpetual loop
- DrawScheduler skal IKKE auto-starte runder for `bingo`-slug
- Kun `MasterActionService.start` (via `POST /api/agent/game1/master/start`) skal starte engine

(Implementert via kill-switch — se §3.4.)

### §2.5 PM auto-pull etter merge

> Tobias håndterer ALDRI git lokalt. PM eier `git pull` i Tobias' main repo etter HVER PR-merge. Hot-reload tar resten. Tobias bare refresher nettleseren.

Fra `~/.claude/projects/-Users-tobiashaugen-Projects-Spillorama-system/memory/feedback_pm_pull_after_merge.md`.

### §2.6 PM verifiser CI etter PR-åpning

> Auto-merge fyrer KUN ved ekte CI-grønning, ikke ved INFRA-fail (schema-gate stale, flaky tests, dependabot fail). Etter ny PR + auto-merge: sjekk `gh pr checks <nr>` etter 5-10 min.

Fra `~/.claude/projects/-Users-tobiashaugen-Projects-Spillorama-system/memory/feedback_pm_verify_ci.md`.

---

## §3 — Konkrete kode-endringer i dag (file:line)

Alle endringer er **kun lokalt** — ikke commitet eller pushet ennå. PR-opprettelse må gjøres som første handling i neste sesjon.

### §3.1 Backend lazy-spawn av scheduled-game

**Fil:** `apps/backend/src/game/MasterActionService.ts`
**Endring:** Ny public-metode `prepareScheduledGame()` som lazy-creater plan-run + scheduled-game UTEN engine.startGame.

```ts
// Linje ~702-820 (etter `start()`-metoden, før `advance()`)
async prepareScheduledGame(input: {
  hallId: string;
  actor: MasterActor;
}): Promise<{
  scheduledGameId: string;
  planRunId: string;
  planRunStatus: Spill1PlanRunStatus;
}>
```

**Hvorfor:** Mark-ready skal kunne kalles før master har startet → backend må kunne forberede scheduled-game-rad uten å starte engine. `MasterActionService.start` brukes senere når master klikker — den er idempotent og bruker eksisterende scheduled-game-rad.

**SKIPPET preValidate** (som krever `GAME1_MASTER_WRITE`) fordi sub-haller må kunne trigge prepare via mark-ready (de har bare `GAME1_HALL_READY_WRITE`). Caller-routen har egen permission-sjekk.

### §3.2 Backend mark-ready route — gameId optional

**Fil:** `apps/backend/src/routes/adminGame1Ready.ts`

**Endringer:**
- `AdminGame1ReadyRouterDeps` har nytt felt: `lazyEnsureScheduledGameForHall?: (input) => Promise<{ scheduledGameId: string }>`
- `POST /api/admin/game1/halls/:hallId/ready` (linje ~283): `gameId` er nå optional. Hvis mangler → kall `lazyEnsureScheduledGameForHall`
- `POST /api/admin/game1/halls/:hallId/no-customers` (linje ~396): samme lazy-flyt

### §3.3 Backend wire-up

**Fil:** `apps/backend/src/index.ts:2867`

**Endring:** Wirer `lazyEnsureScheduledGameForHall` callback som:
1. Finner `masterHallId` via `hallGroupService.list({ hallId, status: "active" })`
2. Validerer at GoH har master-hall (ellers `GROUP_HAS_NO_MASTER`)
3. Kaller `masterActionService.prepareScheduledGame({ hallId: masterHallId, actor })`

PLAYER-rolle eksplisitt avvist i callback (defense-in-depth).

### §3.4 Backend Game1HallReadyService — godta `ready_to_start`-status

**Fil:** `apps/backend/src/game/Game1HallReadyService.ts:255` og `:328`

**Endring:** `markReady()` og `unmarkReady()` aksepterer nå også `ready_to_start`-status (i tillegg til `scheduled` og `purchase_open`).

**Hvorfor:** Game1ScheduleTickService cron flipper status `scheduled → purchase_open → ready_to_start` basert på tid. Hvis lazy-spawn skjer rett før cron tick, hopper status til `ready_to_start` før mark-ready landet. Vi må tillate hele "pre-running"-vinduet.

### §3.5 Backend DrawScheduler kill-switch for `bingo`

**Fil:** `apps/backend/src/util/schedulerSetup.ts:135-200` (`onAutoStart` callback)

**Endring:** Sjekker `snapshot.gameSlug` før engine.startGame. Hvis `slug === "bingo"` → blokker auto-start, logg `[scheduler] auto-start blokkert for Spill 1-rom — krever master-trigger via MasterActionService` (warn-level).

**Hvorfor:** Per Tobias' direktiv §2.4 skal Spill 1 være master-styrt. Tidligere oppførsel var at boot-bootstrap-rom (BINGO_DEMO-PILOT-GOH) ble auto-restartet av DrawScheduler etter hver runde-end → "spill running uten å ha startet" som Tobias rapporterte hele dagen.

Spill 2/3 (`rocket`/`monsterbingo`) påvirkes IKKE — de bruker `PerpetualRoundService`, ikke DrawScheduler.

### §3.6 Frontend cash-inout master-handlinger

**Fil:** `apps/admin-web/src/pages/cash-inout/Spill1HallStatusBox.ts`

**Endringer:**

1. **Idle-state rendrer master-knapp + ready-knapper** (tidligere returnerte tom):
   ```ts
   // I if (!gameStatus)-grenen, linje ~481-515
   const idleMasterButtonsHtml = renderMasterButtons({...canStart: data.isMasterAgent});
   const idleOwnHallButtonsHtml = renderOwnHallButtons(ownHallSnap, "idle", false, data.isMasterAgent);
   ```

2. **Debug-logging** (linje ~205-225 og ~315-322):
   - `[spill1-lobby] state-change` ved hver scheduledGameId/status/warnings-endring
   - `[spill1-action] click` ved hver master-action-klikk

3. **renderOwnHallButtons** signatur utvidet (linje ~871):
   ```ts
   function renderOwnHallButtons(
     ownHall: Spill1HallReadyStatus | null,
     gameStatus: string,
     hasValidGameId: boolean,
     _isMasterAgent: boolean = false,  // for fremtidig bruk
   ): string
   ```

4. **`editable`-conditions endret** (linje ~881-888):
   ```ts
   const editable =
     gameStatus === "scheduled" ||
     gameStatus === "purchase_open" ||
     gameStatus === "ready_to_start" ||
     gameStatus === "idle";  // <-- 2026-05-09: lazy-spawn
   ```

5. **renderStatusPill** — fjernet `hasNoCustomers` fra "Ekskludert"-condition (linje ~852-877):
   ```ts
   if (h.excludedFromGame) {  // <-- IKKE lenger || h.hasNoCustomers
     return `<span ...>Ekskludert</span>`;
   }
   ```

6. **onClick mark-ready/no-customers** — godta `gameId=null` (linje ~328-369):
   ```ts
   case "mark-ready":
     await markHallReadyForGame(ownHallId, gameId);  // gameId kan være null
     break;
   ```

### §3.7 Frontend API — gameId optional

**Fil:** `apps/admin-web/src/api/agent-game1.ts`

**Endringer:** Linje ~156-180 og ~188-215.

```ts
export async function markHallReadyForGame(
  hallId: string,
  gameId: string | null,  // <-- nullable nå
  digitalTicketsSold?: number,
): Promise<unknown>

export async function setHallNoCustomersForGame(
  hallId: string,
  gameId: string | null,  // <-- nullable
  reason?: string,
): Promise<unknown>
```

Hvis `gameId === null`, ekskluderes feltet fra body — backend lazy-spawner.

### §3.8 Seed-script permanent fix

**Fil:** `apps/backend/scripts/seed-demo-pilot-day.ts:1857-1880` (`upsertPilotHallGroup`)

**Endring:** Setter nå `master_hall_id`-KOLONNEN eksplisitt (i tillegg til `extra_json.masterHallId` for backward compat).

**Hvorfor:** `GameLobbyAggregator.computeMasterHallId` leser `master_hall_id` fra `app_hall_groups`-tabellen via `HallGroupService.get(...).masterHallId`. Tidligere seed-script lagret kun i extra_json → aggregator returnerte `masterHallId: null` → `isMasterAgent: false` → master-knapper aldri rendret.

### §3.9 reset-state.mjs SQL-fix

**Fil:** `scripts/dev/reset-state.mjs:95-103`

**Endring:** `wallet_transactions.wallet_id` → `wallet_transactions.account_id`. Schema er omdøpt; reset-script var stale.

### §3.10 Tobias' lokale `.env`

**Fil:** `apps/backend/.env` (ikke i git — kun lokalt)

**Endring:**
```
APP_PG_CONNECTION_STRING=postgres://spillorama:spillorama@localhost:5432/spillorama
WALLET_PG_CONNECTION_STRING=postgres://spillorama:spillorama@localhost:5432/spillorama
```

(Tidligere pekte på `tobiashaugen@localhost:5432/spillorama_local` — som ikke finnes på hans Mac.)

**Backup:** `apps/backend/.env.backup-2026-05-09`.

---

## §4 — Test-validering (kjørt av test-engineer agent)

Test-agent kjørte 6 tester via curl mot live-backend. Resultat:

| # | Test | Status |
|---|---|---|
| 1 | Lazy-spawn (master, no gameId) | ✅ PASS |
| 2 | Sub-hall mark-ready (binder seg til samme scheduled-game) | ✅ PASS |
| 3 | Aggregator state konsistent | ✅ PASS |
| 4 | Master start idempotent | ✅ PASS (bridge gjenbruker scheduled-game) |
| 5 | DrawScheduler kill-switch for bingo | ✅ PASS (ingen auto-restart i 12s) |
| 6 | Ingen falsk "Ekskludert"-pille | ✅ PASS |

**Bug funnet (P0 — ikke pilot-blokker):** `GamePlanEngineBridge.createScheduledGameForPlanRunPosition` (linje ~837) gjenbruker `cancelled` scheduled-game-rader pga idempotency-lookup på `(plan_run_id, plan_position)` uten status-filter. Hvis runde cancelles og ny prøves spawnes på samme posisjon → bug oppstår. Fix-anbefaling: filtrer `WHERE status NOT IN ('cancelled','finished')`.

---

## §5 — Kjente bugs og oppfølger-arbeid

### §5.1 Pilot-blokker (NESTE SESJON)

**Spillerklient ikke koblet til plan-runtime.** Detaljer i §6.

### §5.2 P0 (rask fix når dårlig stund)

**`GamePlanEngineBridge` cancelled-rad-gjenbruk** (se §4). Treffer Tobias når en runde har vært cancelled tidligere samme dag. Symptom: mark-ready feiler med `GAME_NOT_READY_ELIGIBLE: 'cancelled'`. Workaround: cleanup cancelled-rader via SQL.

### §5.3 P1 (separat fra cash-inout)

**`/admin/agent/games` (NextGamePanel) mark-ready skriver ikke til DB.** Tobias verifiserte at klikk på "Marker som klar" viser grønn pille i Klar-status-seksjonen, men DB-tabellen `app_game1_hall_ready_status` + audit-log forblir TOM. Mest sannsynlig:
- NextGamePanel oppdaterer kun lokal state etter API-kall
- Eller API-kall feiler stille (uten errror)
- Eller bruker en annen route som er broken

Diagnose-trinn for neste sesjon:
```bash
# Sjekk audit-log etter klikk
PGPASSWORD=spillorama psql -h localhost -U spillorama -d spillorama -c "
SELECT action, created_at FROM app_audit_log
WHERE action LIKE '%hall%' ORDER BY created_at DESC LIMIT 5;"

# Inspiser NextGamePanel kode
grep -n "markReady\|markHallReady" apps/admin-web/src/pages/agent-portal/NextGamePanel.ts
```

### §5.4 P2 (post-pilot)

- BongCard-farge-paritet: spillerklient bruker 8 hardkodete farger, spec sier 3 (hvit/gul/lilla)
- Game1Controller bruker default `variantConfig` som `STANDARD` — skal hentes fra plan-runtime

---

## §6 — Plan for neste sesjon: Spillerklient ↔ plan-runtime

**Estimat:** 4-8 timer fokusert arbeid (1-2 agent-sesjoner)

### §6.1 Symptomer (fra Tobias' screenshots, kveld 2026-05-09)

Spiller åpner `http://localhost:4000/web/?dev-user=demo-spiller-1` → velger Demo Bingohall 1:

- **Header:** "Neste spill: **STANDARD**" (skal være "Bingo")
- **Auto-countdown** uten master-trigger (skal vente)
- Etter "0" → **"..."** vises (degradert state)
- **Buy-popup viser 8 bongfarger:** Small Yellow/White/Purple/Red/Green/Orange + Large Yellow/White (skal være 3 — hvit/gul/lilla)
- **Bongegrid** rendres ikke korrekt før kjøp

### §6.2 Root cause

`packages/game-client/src/games/game1/Game1Controller.ts` bruker **eldre per-hall room-modell** (legacy `BINGO_HALL-001`-rom), ikke plan-runtime aggregator.

Spesifikke problemer:

1. **Spill-navn fra `variantConfig.gameType`** (default "STANDARD") istedenfor `lobby.planMeta.catalogDisplayName` ("Bingo")
2. **Bongfarger fra `DEFAULT_GAME1_TICKET_TYPES`** (8 stk hardkodet) istedenfor `lobby.scheduledGameMeta.ticketConfig` eller catalog
3. **Lokal auto-countdown** istedenfor å lytte på `lobby.scheduledGameStatus` transition `purchase_open → running`
4. **Fallback-views** ("...") når koblign feiler — skal vises "Venter på master"

### §6.3 Konkret fix-plan

**Fase 1 — Aggregator-data inn i Game1Controller (~2 timer)**

1. Game1Controller henter `Spill1AgentLobbyState` fra `/api/agent/game1/lobby?hallId=X`
   - Allerede eksisterer som endpoint — se `apps/backend/src/routes/agentGame1Lobby.ts`
   - LobbyFallback bruker det allerede via `Spill1LobbyState` — sjekk `packages/game-client/src/games/game1/logic/LobbyFallback.ts`

2. Erstatt hardkodet `STANDARD` med `lobby.planMeta?.catalogDisplayName ?? "Spill 1"`
   - Pekepunkt: søk i Game1Controller.ts etter `gameType` eller `STANDARD`-tekst
   - Vise i header-komponenten (sannsynligvis `CenterTopPanel.ts` eller lignende)

**Fase 2 — Bongfarger fra plan-runtime (~2 timer)**

1. Backend må eksponere `ticketColors` i `lobby.scheduledGameMeta` eller `lobby.planMeta`
   - Allerede beregnet i `GameCatalogEntry.ticketColors` + `ticketPricesCents`
   - Sjekk `apps/backend/src/game/GameLobbyAggregator.ts` linje ~440 for hvor scheduledGameMeta bygges
   - Legg til `ticketColors: TicketColor[]` + `ticketPricesCents: Record<TicketColor, number>` i schema (`packages/shared-types/src/spill1-lobby-state.ts`)

2. Frontend `BuyPopup.ts` (eller hva-det-nå-heter) leser fra lobby-state
   - Erstatt `DEFAULT_GAME1_TICKET_TYPES` med dynamisk fra lobby
   - Spill 1 default: 3 farger (hvit/gul/lilla) per katalog
   - Trafikklys: 1 farge (flat 15 kr) — håndter spesialtilfelle
   - Per `SPILL_REGLER_OG_PAYOUT.md` §2

**Fase 3 — Vente-på-master state (~2 timer)**

1. Når `lobby.scheduledGameStatus !== "running"` → vis "Venter på master"-tekst
2. Fjern lokal auto-countdown — lytt kun på lobby-state-update via socket
3. Når status flipper til `"running"` → start gameplay

**Fase 4 — Acceptance-tester (~1 time)**

Test-engineer agent kjører via curl + Chrome DevTools MCP:

1. Master starter ikke spill → spiller ser "Bingo (venter på master)"
2. Master klikker Start → spiller ser countdown-til-første-trekning
3. Buy-popup viser kun 3 farger (hvit/gul/lilla) for Bingo
4. For Trafikklys-katalog: 1 farge flat 15 kr
5. Etter Fullt Hus → spiller ser ny "venter på master" inntil master starter neste runde

### §6.4 Filer som sannsynligvis rør

- `packages/game-client/src/games/game1/Game1Controller.ts` (hovedfilen)
- `packages/game-client/src/games/game1/logic/LobbyFallback.ts` (allerede har lobby-aggregator-kobling — kanskje gjenbrukbar)
- `packages/game-client/src/games/game1/components/BongCard.ts` eller `BuyPopup.ts` (bongfarger)
- `packages/game-client/src/games/game1/components/CenterTopPanel.ts` (header-tekst)
- `packages/shared-types/src/spill1-lobby-state.ts` (utvide schema med ticketColors)
- `apps/backend/src/game/GameLobbyAggregator.ts` (eksponere ticket-config)

### §6.5 Akseptanse-kriterier

Pilot-klar for spillerklient når:

- [ ] Spiller åpner `/web/?dev-user=demo-spiller-1` + velger Demo Bingohall 1
- [ ] Header viser "Bingo (venter på master)" (ikke "STANDARD")
- [ ] Ingen auto-countdown — sider vises stille inntil master klikker Start
- [ ] Buy-popup viser 3 farger: Hvit (5 kr), Gul (10 kr), Lilla (15 kr)
- [ ] Master klikker Start → spiller ser countdown-til-første-trekning
- [ ] Etter Fullt Hus → spiller ser "Bingo — runde ferdig" og deretter "Bingo (venter på master)" for neste runde
- [ ] INGEN "..." eller andre fallback-views

---

## §7 — Lokal dev-stack — kommandoer

### §7.1 Restart hele stacken (vanligst)

```bash
cd /Users/tobiashaugen/Projects/Spillorama-system && lsof -nP -iTCP:4000,4001,5174,5175 -sTCP:LISTEN -t 2>/dev/null | xargs -r kill -9; sleep 2 && npm run dev:all
```

### §7.2 Ren restart (med Redis FLUSHALL + DB cleanup)

```bash
# Drep alle stale node-prosesser
ps aux | grep -E "tsx watch.*src/index.ts|spillorama|dev:all|start-all\.mjs" | grep -v grep | awk '{print $2}' | xargs -r kill -9

# Flush Redis
docker exec spillorama-system-redis-1 redis-cli FLUSHALL

# Cancel stale runder
PGPASSWORD=spillorama psql -h localhost -U spillorama -d spillorama -c "
UPDATE app_game1_scheduled_games SET status='cancelled', actual_end_time=now()
WHERE status IN ('running','purchase_open','ready_to_start','paused');
UPDATE app_game_plan_run SET status='finished', finished_at=now()
WHERE status NOT IN ('finished','idle');"

# Slett stale orphan-rader (fra fortid uten plan_run_id)
PGPASSWORD=spillorama psql -h localhost -U spillorama -d spillorama -c "
DELETE FROM app_game1_scheduled_games WHERE status='scheduled'
  AND scheduled_start_time < now() - interval '1 hour' AND plan_run_id IS NULL;"

# Restart
cd /Users/tobiashaugen/Projects/Spillorama-system && npm run dev:all
```

### §7.3 Re-seed demo-data hvis DB rotet

```bash
APP_PG_CONNECTION_STRING="postgres://spillorama:spillorama@localhost:5432/spillorama" \
  npm --prefix apps/backend run seed:demo-pilot-day
```

NB: Denne setter `master_hall_id` korrekt nå (etter §3.8-fix).

### §7.4 Type-check

```bash
npm --prefix apps/backend run check     # Backend
npm --prefix apps/admin-web run check   # Admin-web
```

### §7.5 Curl-tester for backend (verifisering)

```bash
# Master-login
TOKEN=$(curl -s -X POST http://localhost:4000/api/agent/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"demo-agent-1@spillorama.no","password":"Spillorama123!"}' \
  | python3 -c "import json,sys; print(json.load(sys.stdin)['data']['accessToken'])")

# Lobby state
curl -s "http://localhost:4000/api/agent/game1/lobby?hallId=demo-hall-001" \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool

# Mark-ready uten gameId (lazy-spawn)
curl -s -X POST "http://localhost:4000/api/admin/game1/halls/demo-hall-001/ready" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{}' | python3 -m json.tool

# Master start
curl -s -X POST "http://localhost:4000/api/agent/game1/master/start" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"hallId":"demo-hall-001"}' | python3 -m json.tool
```

### §7.6 DB-state-sjekk

```bash
# Aktive scheduled-games
PGPASSWORD=spillorama psql -h localhost -U spillorama -d spillorama -c "
SELECT id, status, master_hall_id, plan_position, scheduled_start_time::time
FROM app_game1_scheduled_games WHERE status NOT IN ('finished','cancelled')
ORDER BY updated_at DESC LIMIT 5;"

# Hall-ready-status
PGPASSWORD=spillorama psql -h localhost -U spillorama -d spillorama -c "
SELECT game_id, hall_id, is_ready, excluded_from_game
FROM app_game1_hall_ready_status WHERE updated_at > now() - interval '5 minutes';"

# Master-hall på GoH
PGPASSWORD=spillorama psql -h localhost -U spillorama -d spillorama -c "
SELECT id, name, master_hall_id FROM app_hall_groups;"

# Aktive game_sessions (bør være tomme hvis master ikke startet)
PGPASSWORD=spillorama psql -h localhost -U spillorama -d spillorama -c "
SELECT room_code, status, started_at FROM game_sessions
WHERE status='RUNNING' ORDER BY started_at DESC LIMIT 5;"
```

---

## §8 — URL-er for testing

| URL | Hva |
|---|---|
| `http://localhost:5174/admin/` | Admin-konsoll (port 5174) |
| `http://localhost:5174/admin/agent/cashinout` | **Master cash-inout dashboard (det vi har fokusert på)** |
| `http://localhost:5174/admin/agent/games` | NextGamePanel (har separat bug — se §5.3) |
| `http://localhost:5174/admin/#/games/catalog` | 13 katalog-spill listet |
| `http://localhost:5174/admin/#/groupHall` | GoH master-hall-velger |
| `http://localhost:4000/web/?dev-user=demo-spiller-1` | **Spillerklient (gjenstår å fikse — §6)** |
| `http://localhost:4000/admin/#/tv/demo-hall-001/11111111-1111-4111-8111-111111111111` | TV-skjerm |

### Login-credentials (alle bruker `Spillorama123!`)

| Rolle | E-post | Hall |
|---|---|---|
| Admin | `tobias@nordicprofil.no` | (ingen) |
| Master-agent | `demo-agent-1@spillorama.no` | demo-hall-001 |
| Sub-agent 2 | `demo-agent-2@spillorama.no` | demo-hall-002 |
| Sub-agent 3 | `demo-agent-3@spillorama.no` | demo-hall-003 |
| Sub-agent 4 | `demo-agent-4@spillorama.no` | demo-hall-004 |
| Spiller 1 | `demo-pilot-spiller-1@example.com` | demo-hall-001 |
| ... | ... (12 spillere totalt) | demo-hall-001..004 |

---

## §9 — Doc-er du MÅ lese før kode-endring

I prioritert rekkefølge:

1. **[SPILL1_IMPLEMENTATION_STATUS_2026-05-08.md](../architecture/SPILL1_IMPLEMENTATION_STATUS_2026-05-08.md)** — autoritativ Spill 1 fundament. §3.3 master-flyt + §5 immutable beslutninger.
2. **[SPILL_REGLER_OG_PAYOUT.md](../architecture/SPILL_REGLER_OG_PAYOUT.md)** — kanonisk regel-spec (premier, bongfarger, multi-vinner)
3. **[LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08.md](../architecture/LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08.md)** — Evolution Gaming-grade krav
4. **Denne handoff** — sesjons-historikk + plan
5. **CLAUDE.md** (repo-root) — project conventions
6. `~/.claude/projects/-Users-tobiashaugen-Projects-Spillorama-system/memory/MEMORY.md` — auto-loaded user-memo

---

## §10 — Hva neste PM bør gjøre FØRST

### §10.1 Verifiser at lokal stack fungerer

```bash
cd /Users/tobiashaugen/Projects/Spillorama-system && lsof -nP -iTCP:4000,5174 -sTCP:LISTEN -t 2>/dev/null | xargs -r kill -9; sleep 2 && npm run dev:all
```

Vent ~25 sek. Sjekk at backend lytter:

```bash
curl -s http://localhost:4000/health | head
# Skal returnere {"ok":true,...}
```

### §10.2 Bekreft at master-flyt fortsatt fungerer

Hard-refresh `http://localhost:5174/admin/agent/cashinout` (login: `demo-agent-1@spillorama.no` / `Spillorama123!`).

Du skal se:
- "Min hall: Demo Bingohall 1 (Master) — Klar/Ikke klar pille"
- "Andre haller i gruppen": 3 haller
- "Handlinger for min hall": Marker Klar + Ingen kunder (aktive)
- "Master-handlinger": Start neste spill — Bingo (aktiv grønn)

Hvis IKKE — kjør "Ren restart" fra §7.2.

### §10.3 Opprette PR-er for dagens endringer

Tobias har sagt han ALDRI rør git lokalt. PM skal opprette PR-er for endringene i §3.

```bash
cd /Users/tobiashaugen/Projects/Spillorama-system

# Sjekk status
git status

# Nye filer (kommentar): .env er IKKE i git, ikke forsøk å commite den

# Lag branch
git checkout -b fix/spill1-master-flow-and-lazy-spawn-2026-05-09

# Stage spesifikke filer (IKKE git add -A pga risiko for sensitive filer)
git add apps/backend/src/game/MasterActionService.ts
git add apps/backend/src/routes/adminGame1Ready.ts
git add apps/backend/src/index.ts
git add apps/backend/src/game/Game1HallReadyService.ts
git add apps/backend/src/util/schedulerSetup.ts
git add apps/backend/scripts/seed-demo-pilot-day.ts
git add apps/admin-web/src/pages/cash-inout/Spill1HallStatusBox.ts
git add apps/admin-web/src/api/agent-game1.ts
git add scripts/dev/reset-state.mjs
git add docs/operations/PM_HANDOFF_2026-05-09.md

# Commit (bruk Conventional Commits)
git commit -m "feat(spill1): master-flow + lazy-spawn for pre-game ready

- MasterActionService.prepareScheduledGame: lazy-create scheduled-game without engine.startGame
- adminGame1Ready: gameId now optional in mark-ready/no-customers
- index.ts: wire lazyEnsureScheduledGameForHall callback
- Game1HallReadyService: accept ready_to_start status
- schedulerSetup: kill-switch auto-restart for bingo slug
- seed-demo-pilot-day: set master_hall_id column explicitly
- Spill1HallStatusBox: render master-buttons + own-hall-buttons in idle-state
- agent-game1.ts: gameId nullable in API
- reset-state.mjs: fix wallet_transactions.account_id rename
- docs/PM_HANDOFF_2026-05-09: complete session handoff

Tobias-direktiv: 'Alle haller skal markere seg som klar og deretter
skal master starte spillet når da alle er klare.'

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"

git push -u origin fix/spill1-master-flow-and-lazy-spawn-2026-05-09

# Opprette PR
gh pr create --title "feat(spill1): master-flow + lazy-spawn for pre-game ready" \
  --body "$(cat <<'EOF'
## Summary
- Backend lazy-spawner scheduled-game når mark-ready klikkes uten gameId
- Cash-inout master-knapp + ready-knapper rendres i idle-state
- DrawScheduler blokker auto-restart for bingo-slug (Spill 1 = master-styrt)
- Seed-script setter master_hall_id permanent

Per Tobias-direktiv: alle haller markerer klar FØR master starter spillet.

## Test plan
- [ ] Master kan klikke Marker Klar i cash-inout idle-state
- [ ] Sub-haller kan markere klar (binder seg til samme scheduled-game)
- [ ] DrawScheduler logger "auto-start blokkert" for bingo-rom
- [ ] markReady DB-skriving verifiseres
- [ ] Reload med ren state via npm run dev:all -- --reset-state

## Kjent gjenstår
Spillerklient ↔ plan-runtime kobling (separat sesjon — se PM_HANDOFF_2026-05-09 §6)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

### §10.4 IKKE start spillerklient-rebuild ennå

Avvent at PR-en mergees + Tobias har bekreftet master-flyten fungerer i prod. Spillerklient-rebuild bør være EGEN PR (kanskje 3-4 sub-PR-er per fase i §6.3).

---

## §11 — Decisions log (sesjons-eksakte)

| Tid | Beslutning | Rasjonale |
|---|---|---|
| 19:23 | Fix `.env` til Docker-Postgres | Tobias' lokale Postgres-instance fantes ikke |
| 19:32 | Sett `master_hall_id` på `demo-pilot-goh` direkte i DB | Quick-fix for å få master-knapp synlig |
| 19:34 | Render master-knapp i `if (!gameStatus)`-grenen | Tidligere returnerte tidlig uten knapp |
| 20:25 | DrawScheduler kill-switch for `bingo`-slug | Tobias: "spill bingo er running uten å ha startet" |
| 20:40 | Lazy-spawn av scheduled-game i mark-ready route | Tobias: "alle haller markerer klar FØR master starter" |
| 21:05 | `Game1HallReadyService.markReady` aksepterer `ready_to_start` | Cron flipper status før mark-ready landet |
| 21:30 | Fjern `hasNoCustomers` fra "Ekskludert"-pille-condition | Tobias screenshot: alle haller "Ekskludert" pga 0 spillere |
| 22:30 | **DECISION A**: lukke sesjon, lage handoff | Tobias slitt; spillerklient-rebuild er for stort for én sesjon |

---

## §12 — Endringslogg på dette dokumentet

| Dato | Endring | Forfatter |
|---|---|---|
| 2026-05-09 | Initial — komplett sesjons-handoff for Spill 1 master-flyt-fix og spillerklient-rebuild-plan | PM-AI Sonnet 4.5 |

---

## §13 — For nestemann som leser dette

Du har all kontekst du trenger. Gjør i denne rekkefølgen:

1. **Les §2 (Tobias' direktiver) i sin helhet.** Hvis du fraviker disse, har du brutt fundamental kontrakt.
2. **Verifiser lokal stack** (§10.1).
3. **Verifiser master-flyt** (§10.2). Hvis broken — kjør ren restart (§7.2).
4. **Opprett PR for dagens endringer** (§10.3). Tobias har lagt seg — ikke vent på svar.
5. **Spør Tobias** før du starter spillerklient-rebuild. Vis ham §6.3 plan og få bekreftelse.

**Hvis Tobias er online og frustrert:**
- Anerkjenn at det har vært lang dag
- Vis konkret hva som er fikset (§3 + tabell i Tl;dr)
- Gi en realistisk vurdering av hva som gjenstår
- IKKE foreslå nye refaktor-bølger med mindre han eksplisitt ber om det

**Hvis kode og doc krangler:** doc-en vinner. Følg [SPILL1_IMPLEMENTATION_STATUS_2026-05-08.md](../architecture/SPILL1_IMPLEMENTATION_STATUS_2026-05-08.md) — om noe i koden motsier den, fix koden eller eskalér til Tobias.

---

**Lykke til. Pilot er nær — siste store blokker er spillerklient-rebuild, og du har en konkret plan i §6.**
