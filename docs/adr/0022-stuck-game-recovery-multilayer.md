# ADR-0022 — Multi-lag stuck-game-recovery for Spill 1 scheduled-runder

**Status:** Accepted
**Dato:** 2026-05-12
**Deciders:** Tobias Haugen (teknisk lead) + PM-AI (Claude Opus 4.7)
**Konsulterer:** —

## Kontekst

Etter codex-PR #1239 (live-room control-plane hardening) er Spill 1 scheduled-
flyten fundamentalt funksjonell: bonge-kjøp, draws, vinner-popups, master-
fortsett, og terminal-til-neste-plan-posisjon virker alle ende-til-ende.

Men en strukturell UX-svakhet gjenstår: **engine auto-pauser etter hver fase-
vinst (Rad 1 → Rad 2 → ... → Fullt Hus) og venter på at master klikker
"Fortsett".** Hvis master glemmer, mister forbindelsen, eller forlater UI,
henger runden indefinitely. Per-hall-state akkumuleres til admin manuelt må
kjøre `POST /api/admin/game1/games/:gameId/stop`.

Tobias-direktiv 2026-05-12:
> "vi må lage en løsning som blir så robust som mulig så det ikke skjer, men
> det bør være en fortsett knapp i ui som er siste utvei hvis ting har låst
> seg"

Med casino-grade-mål (99.95% oppetid, Evolution Gaming-paritet) er
"master glemte" et fail-mode som må håndteres uten manuell admin-intervensjon
i pilot.

## Beslutning

Vi implementerer **fire uavhengige lag** av stuck-recovery i én PR:

### Lag 1 — Auto-resume etter phase-pause (mest hyppige tilfelle)

Når engine auto-pauser etter en fase-vinst, registrerer den
`auto_resume_eligible_at = now() + AUTO_RESUME_DELAY_MS` (default 60s) på
scheduled-game-raden. En ny cron-job (`Game1AutoResumePausedService`) tikker
hvert 5. sek og:

1. Finner scheduled-games hvor `engine_paused=true AND paused_at_phase IS NOT NULL AND auto_resume_eligible_at <= now()`
2. Sjekker `master_last_seen_at` (fra Lag 4): hvis master-heartbeat er friskt
   (< 90s siden sist), skipper auto-resume — master er aktiv og forventes å
   trykke Fortsett selv.
3. Hvis master-heartbeat er stale (> 90s) eller mangler helt, kaller
   `engine.resumeGame(scheduledGameId)` med actor `SYSTEM_ACTOR`.
4. Skriver audit-event `spill1.engine.auto_resume` med reason
   `MASTER_INACTIVE` for regulatorisk sporbarhet.

**Rasjonale:** Master forventes å være tilstede i pilot. Auto-resume kun når
master ikke er aktiv. Hvis master er aktiv (heartbeat OK), respekteres
"Fortsett som master-handling" UX-pakten.

### Lag 2 — Auto-end stuck-game (defense mot kronisk abandonment)

`Game1StuckGameDetectionService` tikker hvert 60. sek og finner scheduled-
games som er virkelig stuck:

- **Stale draws:** `status='running' AND last_drawn_at < now() - INTERVAL '5 min' AND engine_paused=false`
  → engine skulle trekke men gjør det ikke (Redis-feil, draw-scheduler dead)
- **Way over end-time:** `status IN ('running','paused') AND scheduled_end_time + INTERVAL '30 min' < now()`
  → runden er meningsløst lang etter scheduled_end_time

Auto-ender med `engine.endGame(reason=STUCK_AUTO_TIMEOUT | SCHEDULED_END_EXCEEDED)`.
Audit-event `spill1.engine.auto_end_stuck`. Plan-runtime auto-advancer på neste
master-start (allerede i `MasterActionService` fra PR #1239).

**Rasjonale:** Hvis Lag 1 ikke fanget tilfellet (master har vært borte i 30+
min uten heartbeat-evidens), trenger systemet en hard cleanup-grense.

### Lag 3 — UI-banner med Fortsett-spotlight (per Option A)

Per Tobias-direktiv: ingen ny "Skip stuck game"-knapp. Eksisterende "Fortsett"-
knapp er last-resort-affordance. Vi gjør Fortsett mer oppdagbar:

- **Soft banner (gul):** engine paused > 30s: "⏸ Pauset etter fase X. Klikk
  Fortsett for å gå videre."
- **Warning banner (oransje):** auto-resume om < 30s: "Auto-fortsett om Ys".
- **Critical banner (rød):** past `scheduled_end_time` + 5 min: "Auto-avbryt
  om Ymin — runden er forsinket."
- **Visual pulse på Fortsett-knappen** når banner er aktivt.

Aggregator eksponerer `pauseStartedAt`, `autoResumeEligibleAt`,
`stuckAutoEndAt`. Frontend computer time-since-pause og rendrer banner.

### Lag 4 — Master heartbeat (signal for Lag 1)

`Spill1HallStatusBox` (admin-web) emitter `master:heartbeat` socket-event
hvert 30s når master er på cash-inout-siden. Backend-handler oppdaterer
`app_game_plan_run.master_last_seen_at`. Aggregator eksponerer
`masterLastSeenAt` + computet `masterIsActive` (< 90s siden sist).

**Rasjonale:** Uten heartbeat har Lag 1 ingen måte å skille "master sitter
foran skjermen men bevisst venter" fra "master har stengt fanen og gått hjem".
Heartbeat gjør auto-resume safe — den fyrer bare når master beviselig er
borte.

## Konsekvenser

### Positive
- **Pilot-haller går ikke ned ved master-fravær.** Auto-resume holder runder
  i gang innenfor SLA selv om master har et øyeblikks oppmerksomhetstap.
- **Casino-grade SLA-paritet.** Evolution Gaming-mål om 99.95% oppetid blir
  realiserbart — abandoned-runder telles ikke som SLA-brudd.
- **Defense in depth.** Fire uavhengige lag betyr at en bug i ett lag ikke
  bryter recovery — Lag 2 fanger alt Lag 1 misser.
- **Audit-trail bevart.** Auto-resume og auto-end skriver dedikerte audit-
  events for Lotteritilsynet-sporbarhet.
- **Master beholder kontroll.** Hvis master er aktiv (heartbeat friskt),
  respekteres "Fortsett" som master-handling — auto-resume slår ikke inn.

### Negative
- **Mer kompleks codebase.** To nye cron-jobs, en ny socket-event, ny DB-
  state, nye aggregator-felter. Komplekse interaksjoner krever tester.
- **Mulighet for falsk auto-resume.** Hvis master mister nett i 2 min, kan
  Lag 1 fyre selv om master "egentlig var der". Mitigert ved 90s heartbeat-
  threshold + 60s auto-resume-delay = total 2.5 min buffer før auto-resume
  ved fullt nett-tap.
- **Risiko for double-resume race.** Hvis master klikker Fortsett samtidig
  som Lag 1 fyrer, må engine være idempotent. Eksisterende `engine.resumeGame`
  er allerede idempotent (paused → running, no-op hvis allerede running).
- **Heartbeat-spam.** Hvert master-frontend sender 1 event hvert 30s. På 24
  haller × 1500 spillere er det ~50/sek totalt — trivielt for socket.io men
  worth å monitoring.

### Nøytrale
- **Configurable via env** for now. DB-config (per-hall override) kan komme
  senere uten å bryte fundament.
- **Affecterer kun Spill 1 scheduled-flyt.** Spill 2/3 (perpetual rooms) har
  egne robusthet-mekanismer (`PerpetualRoundService`).

## Alternativer vurdert

### Alternativ B (forkastet): Ny "Hopp over fastlåst runde"-knapp
Tobias forkastet eksplisitt 2026-05-12: ingen ny knapp i UI. Eksisterende
"Fortsett" er last-resort. Argumentet: hvis master må trykke "Skip", er det
allerede et brudd — vi skal i stedet auto-recovere før det skjer.

### Alternativ C: Bare Lag 2 (auto-end) uten Lag 1 (auto-resume)
For konservativt. Vil resultere i mange "auto-ended" runder hvor master var
borte i 2 min — dårlig UX. Lag 1 reddet runden hvis master kun var midlertidig
borte.

### Alternativ D: Bare Lag 1 + 4 uten Lag 2
Insufficient defense. Hvis Lag 1 bug-er ut eller Redis er nede (master_last_seen_at
ikke oppdateres), trenger vi siste-skanse-cleanup.

### Alternativ E: DB-konfig fra dag 1
Over-engineered for pilot. Env-vars holder mens vi lærer hvilke verdier som
faktisk fungerer. DB-konfig kommer i post-pilot om verdiene må variere per
hall.

## Implementasjon

**Nye filer:**
- `apps/backend/migrations/20260801000000_game1_stuck_recovery.sql`
- `apps/backend/src/game/Game1AutoResumePausedService.ts` (+ test)
- `apps/backend/src/game/Game1StuckGameDetectionService.ts` (+ test)
- `apps/backend/src/jobs/game1AutoResumePaused.ts`
- `apps/backend/src/jobs/game1StuckGameDetection.ts`
- `apps/backend/src/sockets/masterHeartbeatEvents.ts` (+ test)

**Modifiserte filer:**
- `apps/backend/src/game/Game1DrawEngineService.ts` — sett `auto_resume_eligible_at` ved auto-pause
- `apps/backend/src/game/GameLobbyAggregator.ts` — eksponer nye felter
- `apps/backend/src/index.ts` — registrer cron-jobs + socket-handler
- `apps/admin-web/src/pages/cash-inout/Spill1HallStatusBox.ts` — banner + heartbeat-sender
- `apps/admin-web/src/api/agent-game1.ts` — utvid lobby-state-typen
- `packages/shared-types/src/spill1-lobby-state.ts` — nye felter

**Env-konfig:**
```
GAME1_AUTO_RESUME_ENABLED=true
GAME1_AUTO_RESUME_DELAY_MS=60000           # 1 min etter phase-pause
GAME1_AUTO_RESUME_TICK_INTERVAL_MS=5000    # cron-tick

GAME1_STUCK_DETECTION_ENABLED=true
GAME1_STUCK_DETECTION_INTERVAL_MS=60000    # cron-tick
GAME1_STUCK_NO_DRAWS_THRESHOLD_MS=300000   # 5 min uten draws
GAME1_STUCK_PAST_END_THRESHOLD_MS=1800000  # 30 min over end-time

GAME1_MASTER_HEARTBEAT_INTERVAL_MS=30000   # frontend emit-interval
GAME1_MASTER_HEARTBEAT_TIMEOUT_MS=90000    # 90s = master inaktiv
```

**Relaterte skills:**
- `live-room-robusthet-mandate` (peker hit i Lag 1+2 evidence-of-implementation)
- `spill1-master-flow` (peker hit i auto-pause/resume-flyt)
- `audit-hash-chain` (auto-resume/auto-end-events MÅ skrives til compliance-audit)

## Referanser

- [LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08.md](../architecture/LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08.md) — Evolution-grade SLA-krav
- [SPILL1_IMPLEMENTATION_STATUS_2026-05-08.md](../architecture/SPILL1_IMPLEMENTATION_STATUS_2026-05-08.md) — Spill 1 master-flyt-fundament
- PR #1239 — codex live-room control-plane hardening (forutsetning for denne ADR)
- PR #_TBD_ — implementasjon av denne ADR
- Tobias-direktiv 2026-05-12: Option A (ingen ny skip-knapp) + 4-lag i én PR
