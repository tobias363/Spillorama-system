/**
 * Bølge 1 (2026-05-08): Spill 1 AgentLobbyState — kanonisk single-source-of-
 * truth-shape for master-konsoll og agent-portal-UI.
 *
 * Bakgrunn (audit `PLAN_SPILL_KOBLING_FUNDAMENT_AUDIT_2026-05-08.md`):
 *   Master-konsollet hadde to parallelle ID-rom (plan-run-id og
 *   scheduled-game-id) som krangler. UI hentet `/api/agent/game-plan/current`
 *   OG `/api/agent/game1/current-game` parallelt og merget felt-for-felt;
 *   adapter-en lyver om `currentGame.id` (setter plan-run-id), og master-
 *   handlinger sender feil ID til pause/resume-endpoints. Resultat: gjentatte
 *   patcher (#1041, #1035, #1030) som hver bare maskerer det underliggende
 *   problemet.
 *
 *   Bølge 1 introduserer ÉN kanonisk shape (`Spill1AgentLobbyState`) som
 *   aggregeres på backend (`GameLobbyAggregator`) og eksponeres via ÉN
 *   endpoint (`GET /api/agent/game1/lobby?hallId=X`). UI i Bølge 3 vil
 *   bruke kun denne shape-en og slette adapter + dual-fetch.
 *
 * NB om navnvalg:
 *   `Spill1LobbyState` (uten `Agent`-prefiks) er allerede tatt av den
 *   PUBLIC klient-shell-APIen (`Game1LobbyService`, brukt av spillets
 *   game-client). Den nye aggregator-shapen er for INTERNAL agent-/master-
 *   konsoll-bruk — derfor `AgentLobbyState`. De to shape-ene har overlapp
 *   i konseptene (begge handler om "hva er hallen i?") men forskjellig
 *   målgruppe og felt-sett: spiller-shellen trenger `overallStatus` for
 *   "Stengt"/"Kjøp bonger", master-konsollet trenger ready-pills,
 *   inconsistency-warnings og master-actions-id.
 *
 * Designvalg per felt (begrunnelser i kommentarer under skjemaene):
 *   - `currentScheduledGameId` er UI-ets ENESTE id-felt for master-actions.
 *     Internt aggregeres den fra plan-bridge ELLER legacy-spawn (i den
 *     rekkefølgen). UI skal aldri se plan-run-id eller en alias-id.
 *   - `planMeta` er informativ — UI rendrer "Neste opp: <displayName>" osv.
 *     Aldri bruk `planMeta.planRunId` til en write — det vil treffe feil
 *     backend-rute.
 *   - `scheduledGameMeta` speiler `app_game1_scheduled_games`-state for
 *     den aktive raden. Brukes for status-pillen og opening-time.
 *   - `inconsistencyWarnings` er kontrakten med Bølge 2 (MasterActionService)
 *     og Bølge 3 (UI). Aggregator detekterer kjente "krangler-mot-hverandre"-
 *     scenarioer og flagger dem her, slik at UI kan rendre informativ
 *     feilmelding ("Plan-run sier running men scheduled-game er cancelled —
 *     refresh?") istedet for å bare henge i polling-loop.
 *
 * Wire-stabilitet:
 *   Schemaet er Zod-validert slik at både backend og frontend kan parse
 *   responsen runtime og fange version-skew. Type-eksport
 *   (`Spill1AgentLobbyState`) er primær for TypeScript-callers.
 *
 * Bakover-kompatibilitet:
 *   Eksisterende endpoints (`/api/agent/game1/current-game`,
 *   `/api/agent/game-plan/current`, `/api/admin/game1/games/:id/...`)
 *   forblir uendret. Frontend bytter til ny endpoint i Bølge 3.
 */

import { z } from "zod";

// ── enum-sub-schemas ────────────────────────────────────────────────────

/**
 * Aggregert farge-kode per hall. Speiler `Game1HallReadyService.HallStatusColor`
 * men er definert her i shared-types så UI ikke må importere fra backend-
 * pakker.
 *
 * Semantikk (låst Tobias 2026-04-24):
 *   - red    : `playerCount === 0` (auto-ekskluderes)
 *   - orange : `playerCount > 0` og (!finalScanDone || !readyConfirmed)
 *   - green  : alt klart
 *   - gray   : Aggregator-spesifikk verdi for "ikke participating ennå"
 *              (når lobby-state aggregeres FØR scheduled-game eksisterer).
 *              Backend mapper dette automatisk fra "ingen ready-rad" + "ikke
 *              i participating_halls_json" når runden ikke har spawnet.
 */
export const Spill1HallStatusColorSchema = z.enum([
  "red",
  "orange",
  "green",
  "gray",
]);
export type Spill1HallStatusColor = z.infer<typeof Spill1HallStatusColorSchema>;

/**
 * Plan-runtime-status fra `app_game_plan_run.status`. Identisk med
 * backend-typen `GamePlanRunStatus` — vi duplikerer her for å unngå
 * cross-package import fra shared-types til backend.
 */
export const Spill1PlanRunStatusSchema = z.enum([
  "idle",
  "running",
  "paused",
  "finished",
]);
export type Spill1PlanRunStatus = z.infer<typeof Spill1PlanRunStatusSchema>;

/**
 * Scheduled-game-status fra `app_game1_scheduled_games.status`. Speiler
 * `Game1ScheduledGameStatusSchema` i `schemas/game1-scheduled.ts`. Vi
 * duplikerer her fordi denne fila er en del av lobby-state-kontrakten,
 * og vi ikke vil tvinge cross-import bare for én enum.
 */
export const Spill1ScheduledGameStatusSchema = z.enum([
  "scheduled",
  "purchase_open",
  "ready_to_start",
  "running",
  "paused",
  "completed",
  "cancelled",
]);
export type Spill1ScheduledGameStatus = z.infer<
  typeof Spill1ScheduledGameStatusSchema
>;

/**
 * Aggregator-spesifikke inconsistency-koder. Kontrakten med Bølge 2+3
 * er at NYE koder kan legges til over tid (UI viser ukjente koder som
 * "Ukjent feil — kontakt support"), men eksisterende koder er stabile.
 *
 * Liste skal speile koder dokumentert i `GameLobbyAggregator.detectInconsistencies`
 * sin JSDoc.
 */
export const Spill1LobbyInconsistencyCodeSchema = z.enum([
  /**
   * Plan-run sier `running` men scheduled-game er `cancelled` (eller
   * omvendt). UI viser warning og oppfordrer refresh; master-actions
   * MasterActionService må reconciliere.
   */
  "PLAN_SCHED_STATUS_MISMATCH",
  /**
   * `participating_halls_json` peker på hallId som ikke lenger er aktiv
   * GoH-medlem. Aggregator filtrerer hallen ut av `halls[]` automatisk
   * og flagger her så UI kan vise "noen haller fjernet"-info.
   */
  "MISSING_GOH_MEMBERSHIP",
  /**
   * Plan-run for businessDate i går eller eldre er fortsatt åpen
   * (ikke `finished`). Master har trolig glemt å avslutte forrige dag.
   */
  "STALE_PLAN_RUN",
  /**
   * Plan-run.status='running' men ingen scheduled-game eksisterer —
   * bridge-spawn feilet. UI bør vise feil og oppfordre master til å
   * kalle advance/start på nytt.
   */
  "BRIDGE_FAILED",
  /**
   * To scheduled-games for samme hall samtidig (legacy-spawn fra
   * Game1ScheduleTickService + plan-bridge spawn). Aggregator velger
   * plan-bridge først (audit-spec) og logger denne warning for
   * cleanup. C1-konflikt fra audit-rapport §5.
   */
  "DUAL_SCHEDULED_GAMES",
]);
export type Spill1LobbyInconsistencyCode = z.infer<
  typeof Spill1LobbyInconsistencyCodeSchema
>;

// ── nested schemas ─────────────────────────────────────────────────────

/**
 * Per-hall ready-status. Brukes av master-konsoll for å rendre hall-pills.
 *
 * `colorCode` aggregeres fra ready-rad + scan-state + customer-count;
 * eksakt logikk lever i `Game1HallReadyService.computeHallStatus`. Vi
 * eksponerer den ferdig-beregnede koden her så UI ikke trenger å duplisere
 * regelen.
 */
export const Spill1HallReadyStatusSchema = z.object({
  hallId: z.string(),
  hallName: z.string(),
  /**
   * `true` hvis bingoverten har trykket "Klar" og hallen er innenfor
   * purchase-vinduet eller har gått til ready_to_start.
   */
  isReady: z.boolean(),
  /**
   * `true` hvis hallen har trykket "Ingen kunder" eller har 0 spillere.
   * UI rendrer dette som rødt og excluderer hallen fra start-action.
   */
  hasNoCustomers: z.boolean(),
  /**
   * `true` hvis hallen er ekskludert fra runden (enten via "Ingen kunder"
   * eller manuell ekskludering av master). Speiler
   * `app_game1_hall_ready_status.excluded_from_game`.
   */
  excludedFromGame: z.boolean(),
  /**
   * Fritekst-grunn for ekskludering, eller null. Brukes i UI-tooltip.
   */
  excludedReason: z.string().nullable(),
  /**
   * Aggregert farge for hall-pill-rendering. UI skal aldri beregne
   * fargen selv — alltid stol på denne.
   */
  colorCode: Spill1HallStatusColorSchema,
  /**
   * ISO-timestamp for siste oppdatering av ready-status (eller null hvis
   * hallen aldri har trykket noe). Brukes i UI til "sist oppdatert"-tekst.
   */
  lastUpdatedAt: z.string().datetime().nullable(),
  /**
   * `true` hvis denne hallen er master for runden. Drives av
   * `app_game1_scheduled_games.master_hall_id`. UI viser kron-emoji.
   */
  isMaster: z.boolean(),
});
export type Spill1HallReadyStatus = z.infer<typeof Spill1HallReadyStatusSchema>;

/**
 * Plan-runtime-meta som UI rendrer i "Neste opp"-blokken og master-progress.
 *
 * VIKTIG: `planRunId` skal IKKE brukes til write-actions (audit §3.1
 * forklarer hvorfor — det er roten til pause-bugen). Bruk
 * `currentScheduledGameId` på top-level istedet.
 */
export const Spill1PlanMetaSchema = z.object({
  /** UUID i `app_game_plan_run`. Read-only for UI. */
  planRunId: z.string().uuid(),
  /** UUID i `app_game_plan` (template). */
  planId: z.string().uuid(),
  /** Plan-display-navn. */
  planName: z.string(),
  /**
   * Nåværende posisjon (1-basert). 0 hvis run ikke startet ennå (idle og
   * lazy-create returnerte run uten advance).
   */
  currentPosition: z.number().int().nonnegative(),
  /** Antall items i planen. */
  totalPositions: z.number().int().positive(),
  /** Catalog-slug for nåværende item (`innsatsen`, `jackpot`, `oddsen-55`...). */
  catalogSlug: z.string(),
  /** Catalog-display-navn for UI. */
  catalogDisplayName: z.string(),
  /** Plan-run.status. */
  planRunStatus: Spill1PlanRunStatusSchema,
  /**
   * `true` hvis nåværende item er en jackpot-runde og master har ikke
   * lagret override ennå. UI viser jackpot-popup ved start.
   */
  jackpotSetupRequired: z.boolean(),
  /**
   * Pre-fyll for jackpot-popup hvis admin har satt override tidligere.
   * Frontend kan typecaste dette til `JackpotOverride`-shape — vi bruker
   * `unknown` her for å unngå cross-package import.
   */
  pendingJackpotOverride: z.unknown().nullable(),
});
export type Spill1PlanMeta = z.infer<typeof Spill1PlanMetaSchema>;

/**
 * Scheduled-game-meta. Brukes til status-pillen og countdown-rendering.
 *
 * `scheduledGameId` her er den samme som `currentScheduledGameId` på
 * top-level — duplisert for konsistens i nested-objektet.
 */
export const Spill1ScheduledGameMetaSchema = z.object({
  scheduledGameId: z.string().uuid(),
  status: Spill1ScheduledGameStatusSchema,
  /**
   * Planlagt start (ISO-timestamp). Alltid satt — settes av spawn-pathen.
   */
  scheduledStartTime: z.string().datetime(),
  /**
   * Planlagt slutt. Kan være null hvis spawnet uten end-time
   * (legacy daily_schedule-flow tillater det).
   */
  scheduledEndTime: z.string().datetime().nullable(),
  /** Faktisk start (når master trykket Start). Null før start. */
  actualStartTime: z.string().datetime().nullable(),
  /** Faktisk slutt. Null før completion. */
  actualEndTime: z.string().datetime().nullable(),
  /**
   * Pause-årsak hvis runden er paused (master pause / engine auto-pause).
   * Null i alle andre statuser.
   */
  pauseReason: z.string().nullable(),
});
export type Spill1ScheduledGameMeta = z.infer<
  typeof Spill1ScheduledGameMetaSchema
>;

/**
 * Inconsistency-warning. UI rendrer disse som info/varsel-bannere over
 * master-konsollet. `code` er stabil enum, `message` er Norsk-tekst,
 * `detail` er fri-formet diagnose for support.
 */
export const Spill1LobbyInconsistencyWarningSchema = z.object({
  code: Spill1LobbyInconsistencyCodeSchema,
  message: z.string(),
  detail: z.unknown().optional(),
});
export type Spill1LobbyInconsistencyWarning = z.infer<
  typeof Spill1LobbyInconsistencyWarningSchema
>;

// ── top-level schema ───────────────────────────────────────────────────

/**
 * Kanonisk Spill 1 agent-side lobby-state. Aggregeres av
 * `GameLobbyAggregator` (apps/backend/src/game/GameLobbyAggregator.ts) og
 * eksponeres via `GET /api/agent/game1/lobby?hallId=X`.
 *
 * Felt-design-prinsipper:
 *   1. `currentScheduledGameId` er den ENESTE id-en UI bruker for master-
 *      actions (start/pause/resume/stop). Mappet fra plan-bridge ELLER
 *      legacy-spawn — UI bryr seg ikke om hvor den kommer fra.
 *   2. `planMeta` og `scheduledGameMeta` er informative (read-only) —
 *      ingen write-action på id-er der.
 *   3. `halls[]` er ferdig-filtrert mot nåværende GoH-membership. Stale
 *      `participating_halls_json`-haller er allerede skjult og flagget
 *      via `MISSING_GOH_MEMBERSHIP`-warning.
 *   4. `inconsistencyWarnings` er en KONTRAKT — disse blir konsumert av
 *      Bølge 2 (MasterActionService) og Bølge 3 (UI). Listen kan utvides
 *      med nye koder, men aldri reduseres.
 *
 * EMPTY-STATE-SEMANTIKK:
 *   Når aggregator-routen kalles uten hall-context — typisk ADMIN som
 *   poller uten å ha valgt en hall (`agentGame1Lobby.ts` resolveHallScope
 *   returnerer null) — returneres et empty-state der `hallId`, `hallName`
 *   og `businessDate` er `null`. Alle andre felter er fortsatt populert
 *   med tomme defaults (tom `halls[]`, `currentScheduledGameId=null`,
 *   `inconsistencyWarnings=[]`). Frontend rendrer "velg hall først"-state
 *   i denne situasjonen og verken kall masterActions eller polling-loop.
 *   Dette matcher den eksisterende `agentGamePlan.ts:343-380`-strategien
 *   for soft-fail på read-only polling.
 */
export const Spill1AgentLobbyStateSchema = z.object({
  /**
   * Hallen som klienten spurte om. `null` betyr empty-state — ADMIN
   * uten valgt hall. UI rendrer "velg hall"-prompt og kaller hverken
   * master-actions eller poller videre.
   */
  hallId: z.string().nullable(),
  /** Display-navn på hallen. `null` i empty-state. */
  hallName: z.string().nullable(),
  /**
   * ISO-dato (`YYYY-MM-DD`) i Oslo-tidssone. Driver business-date-key
   * i DB. `null` i empty-state.
   */
  businessDate: z.string().nullable(),
  /** ISO-timestamp for når responsen ble generert. UI viser dette i "sist oppdatert". */
  generatedAt: z.string().datetime(),

  /**
   * Den ENESTE id-en UI skal bruke for master-actions. Aggregator-prioritet:
   *   1. Hvis det finnes scheduled-game knyttet til (plan-run-id, current-position)
   *      via `app_game1_scheduled_games.plan_run_id` — bruk DEN.
   *   2. Ellers, hvis det finnes en aktiv scheduled-game (purchase_open /
   *      ready_to_start / running / paused) for hallen via legacy-spawn —
   *      bruk DEN.
   *   3. Ellers `null` (ingen aktiv runde — UI rendrer "Venter på start").
   */
  currentScheduledGameId: z.string().uuid().nullable(),

  /**
   * Plan-runtime-meta hvis en plan dekker dagen og en run finnes. Null
   * hvis ingen plan dekker (hallen ikke i GoH med plan, eller utenfor
   * ukedags-vindu) eller run ikke har blitt opprettet ennå (read-only
   * lookup — `getOrCreateForToday` kalles IKKE av aggregator).
   */
  planMeta: Spill1PlanMetaSchema.nullable(),

  /**
   * Scheduled-game-meta hvis en aktiv rad finnes. Null hvis ingen runde
   * er spawnet ennå (master har ikke kalt /start, eller plan-run står
   * i idle).
   */
  scheduledGameMeta: Spill1ScheduledGameMetaSchema.nullable(),

  /**
   * Per-hall ready-status. Inneholder ALLE haller i nåværende GoH —
   * også de som ikke har trykket Klar (med default-verdier). Master-hall
   * er alltid med (også hvis den ikke er i GoH-membership pga. edge-case).
   *
   * Stale-haller (i `participating_halls_json` men fjernet fra GoH) er
   * allerede filtrert UT, og vi setter `MISSING_GOH_MEMBERSHIP`-warning
   * hvis det skjedde.
   */
  halls: z.array(Spill1HallReadyStatusSchema),

  /**
   * `true` hvis alle ikke-ekskluderte haller har `isReady=true` OG minst
   * én hall finnes. Master-konsoll bruker dette til å aktivere "Start
   * neste runde"-knappen.
   */
  allHallsReady: z.boolean(),

  /**
   * Master-hall for runden. Null hvis ingen aktiv runde finnes.
   * Alltid lik `scheduledGameMeta.master_hall_id` når
   * `scheduledGameMeta != null`.
   */
  masterHallId: z.string().nullable(),

  /**
   * Group-of-halls-id for runden. Null hvis ingen aktiv runde, eller
   * hallen ikke er i en aktiv GoH.
   */
  groupOfHallsId: z.string().nullable(),

  /**
   * `true` hvis CALLER (request-actor) er agent for `masterHallId`. UI
   * bruker dette til å vise/skjule master-knapper. ADMIN er alltid
   * `true`. HALL_OPERATOR/AGENT er `true` kun hvis `actor.hallId === masterHallId`.
   */
  isMasterAgent: z.boolean(),

  /**
   * ISO-timestamp for neste planlagte start. For `idle`-state er dette
   * neste plan-item; for `running`-state er det pågående
   * `actualStartTime`. Null hvis ingen kommende runde.
   */
  nextScheduledStartTime: z.string().datetime().nullable(),

  /**
   * Diagnose-warnings for UI/Bølge 2-callers. Tom liste hvis alt er konsistent.
   */
  inconsistencyWarnings: z.array(Spill1LobbyInconsistencyWarningSchema),
});
export type Spill1AgentLobbyState = z.infer<typeof Spill1AgentLobbyStateSchema>;
