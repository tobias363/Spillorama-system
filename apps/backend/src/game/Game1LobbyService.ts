/**
 * Spilleplan-lobby for Spill 1 (2026-05-08).
 *
 * Bakgrunn (Tobias-direktiv 2026-05-08):
 * "Så lenge rommet er åpent skal man ha mulighet til å gå inn i rommet og
 *  kjøpe bonger. Åpningstidene blir da samme som spilleplanen. Hvis det er
 *  satt til 11:00-21:00 da er åpningstiden på rommet det samme. Når man
 *  kommer inn i rommet ser man da neste planlagte spill og kan kjøpe bonger
 *  til dette spillet."
 *
 * Doc-festet i `docs/architecture/SPILL_DETALJER_PER_SPILL.md` §1.0.1.
 *
 * Tidligere oppførsel:
 *   Klient kobler til en `app_game1_scheduled_games`-rad direkte. Hvis
 *   ingen rad er i `purchase_open` eller `running` får klient
 *   "FÅR IKKE KOBLET TIL ROM"-feil. Det betyr at rommet "åpner" først når
 *   master har trykket Start på første runde — kunder som logger inn 5
 *   minutter før første runde stenges ute.
 *
 * Nytt:
 *   Klient kobler til "lobby-state" per hall. Lobby-state er åpen så lenge
 *   `now ∈ [plan.startTime, plan.endTime]` for en plan som dekker hallen
 *   (direkte hall-binding eller GoH-medlemskap), og UI viser
 *   "neste planlagte spill" basert på `app_game_plan_run.current_position +
 *   plan.items`. Når master har spawnet et scheduled-game returnerer
 *   service-en også `scheduledGameId` og status, slik at klient kan flytte
 *   over til runde-modus i samme rom.
 *
 * Source-of-truth:
 *   - Plan-template: `app_game_plan` + `app_game_plan_item` (les via
 *     GamePlanService).
 *   - Plan-runtime: `app_game_plan_run` (les via GamePlanRunService).
 *   - Aktivt scheduled-game: `app_game1_scheduled_games` (direkte SELECT).
 *
 * Service-en gjør INGEN write — kun read. Master driver state-overgangene
 * via `agentGamePlan.ts`-routene; lobby-service rapporterer bare hva som
 * synes for kunden.
 *
 * Bakover-kompatibilitet:
 *   Eksisterende `game1:join-scheduled` socket-handler påvirkes IKKE.
 *   Denne service-en eksponeres via en NY public REST-rute
 *   (`GET /api/games/spill1/lobby?hallId=...`) og gjenbruker eksisterende
 *   service-objekter.
 */

import type { Pool } from "pg";

import { DomainError } from "../errors/DomainError.js";
import { logger as rootLogger } from "../util/logger.js";
import { todayOsloKey, nowOsloHourMinute } from "../util/osloTimezone.js";
import type { GamePlanService } from "./GamePlanService.js";
import type { GamePlanRunService } from "./GamePlanRunService.js";
import type {
  GamePlan,
  GamePlanWithItems,
  GamePlanRun,
  GamePlanRunStatus,
  Weekday,
} from "./gamePlan.types.js";
import type { GameCatalogEntry } from "./gameCatalog.types.js";

const logger = rootLogger.child({ module: "game1-lobby-service" });

// Spill 1 catalog-slugs er en familie — alle 12 varianter under "bingo"-
// paraplyen er Spill 1 (BingoEngine + Game1DrawEngineService). Når plan-
// item peker til en av disse, er det Spill 1-runde i lobbyen.
//
// Lista holdes i synk med SPILL_DETALJER_PER_SPILL.md §1.2-1.14. Vi sjekker
// IKKE mot denne lista i lobbien — alle items i planen som er aktive vises.
// Den er kun her for dokumentasjon. Andre spill (Spill 2/3/SpinnGo) bruker
// en separat plan-mekanisme i fremtiden hvis behov.

// ── wire-format for lobby-respons ───────────────────────────────────────

/** Status for spilleplanen som helhet — driver UI-state i klient. */
export type Game1LobbyOverallStatus =
  /** Rommet er stengt (utenfor åpningstid eller ingen plan dekker dagen). */
  | "closed"
  /** Rommet er åpent men ingen scheduled-game er spawnet ennå. */
  | "idle"
  /** Bonger kan kjøpes til neste runde. */
  | "purchase_open"
  /** Master har klargjort runden — bonger fortsatt kjøpbare i kort vindu. */
  | "ready_to_start"
  /** Runden kjører — klient skal bytte til runde-modus. */
  | "running"
  /** Runden er pauset — klient venter. */
  | "paused"
  /** Spilleplanen er fullført for dagen. */
  | "finished";

export interface Game1LobbyNextGame {
  /** ID i `app_game_plan_item`. */
  itemId: string;
  /** 1-basert posisjon i planen. */
  position: number;
  /** Catalog-slug (`innsatsen`, `jackpot`, `oddsen-55`, ...). */
  catalogSlug: string;
  /** Visningsnavn fra catalog. */
  catalogDisplayName: string;
  /**
   * Status fra `app_game1_scheduled_games.status` hvis master har spawnet
   * runden, ellers en avledet plan-status:
   *   - `idle` = master har ikke kalt /start ennå (run.status='idle')
   *   - `purchase_open` = scheduled-game eksisterer i purchase_open
   *   - `ready_to_start` = scheduled-game eksisterer i ready_to_start
   *   - `running` = scheduled-game eksisterer i running
   *   - `paused` = scheduled-game eksisterer i paused
   */
  status: Game1LobbyOverallStatus;
  /**
   * `app_game1_scheduled_games.id` hvis spawnet. NULL hvis runden ikke har
   * blitt spawnet ennå (run i `idle`-state, eller mellom rundene før
   * advance er kalt).
   */
  scheduledGameId: string | null;
  /** Estimert ISO-timestamp for når runden starter (kun hvis status=ready_to_start/purchase_open). */
  scheduledStartTime: string | null;
  /** Master har trykket klar — short window før runden går "running". */
  scheduledEndTime: string | null;
  /** ISO-timestamp for `actual_start_time` (kun hvis status=running). */
  actualStartTime: string | null;
}

export interface Game1LobbyState {
  /** Hallen som klient spurte om. */
  hallId: string;
  /** Forretnings-dato i Oslo-tz (`YYYY-MM-DD`). */
  businessDate: string;
  /** True hvis nåværende klokkeslett ∈ [plan.startTime, plan.endTime]. */
  isOpen: boolean;
  /** Plan-startTime som "HH:MM", eller null hvis ingen plan dekker dagen. */
  openingTimeStart: string | null;
  /** Plan-endTime som "HH:MM", eller null hvis ingen plan dekker dagen. */
  openingTimeEnd: string | null;
  /** Aktiv plan-id, eller null hvis ingen plan dekker dagen. */
  planId: string | null;
  /** Plan-navn for UI, eller null. */
  planName: string | null;
  /**
   * Aktivt run-id, eller null. Run kan eksistere selv om rommet teknisk
   * er stengt (master har lukket dagen sent). Klient bruker
   * `isOpen + nextScheduledGame.status` for å bestemme oppførsel.
   */
  runId: string | null;
  /** Run-status, eller null. */
  runStatus: GamePlanRunStatus | null;
  /**
   * Aggregert status for hele lobby-vinduet. Driver klient-UI-state:
   *   - `closed` → "Stengt"-melding (ingen plan eller utenfor åpningstid)
   *   - `idle` → "Venter på start" — bong-kjøp ikke åpent
   *   - `purchase_open` → "Bong-kjøp åpent"
   *   - `ready_to_start` → "Spillet starter snart"
   *   - `running` → "Spillet pågår — bytt til runde-modus"
   *   - `paused` → "Pauset"
   *   - `finished` → "Spilleplanen er ferdig for dagen"
   */
  overallStatus: Game1LobbyOverallStatus;
  /**
   * Neste planlagte spill — alltid populert hvis planen har items igjen,
   * også når runden kjører (klient kan rendre "neste opp"-tekst).
   * NULL hvis planen er ferdig eller ingen plan dekker dagen.
   */
  nextScheduledGame: Game1LobbyNextGame | null;
  /** Posisjon i planen (1-basert). 0 hvis ingen run eller plan er ferdig. */
  currentRunPosition: number;
  /** Antall items i planen. 0 hvis ingen plan dekker dagen. */
  totalPositions: number;
}

// ── interne hjelpere ────────────────────────────────────────────────────

const TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

function timeToMinutes(t: string): number {
  if (!TIME_REGEX.test(t)) return 0;
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

/** "HH:MM" i Oslo-tz, derivert fra Date. */
function osloHHMM(date: Date = new Date()): string {
  const { hour, minute } = nowOsloHourMinute(date);
  const hh = String(hour).padStart(2, "0");
  const mm = String(minute).padStart(2, "0");
  return `${hh}:${mm}`;
}

/** Mapping fra Oslo-dato (yyyy-mm-dd) → ukedag-slug (mon/tue/...). */
function weekdayFromDateStr(dateStr: string): Weekday {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const idx = d.getUTCDay(); // 0=Sunday
  const order: Weekday[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  return order[idx];
}

interface ScheduledGameForLobbyRow {
  id: string;
  status: string;
  scheduled_start_time: Date | string | null;
  scheduled_end_time: Date | string | null;
  actual_start_time: Date | string | null;
  catalog_entry_id: string | null;
}

function asIsoOrNull(value: Date | string | null): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  return value.toISOString();
}

/**
 * Map fra `app_game1_scheduled_games.status` til `Game1LobbyOverallStatus`.
 * Whitelist matcher de eneste statusene som driver klient-UI; alt annet
 * mappes til `idle` (defensivt — engine kan ha future-statuser uten å
 * bryte lobby-respons).
 */
function mapScheduledGameStatus(status: string): Game1LobbyOverallStatus {
  switch (status) {
    case "purchase_open":
      return "purchase_open";
    case "ready_to_start":
      return "ready_to_start";
    case "running":
      return "running";
    case "paused":
      return "paused";
    case "finished":
      return "finished";
    default:
      return "idle";
  }
}

// ── service ─────────────────────────────────────────────────────────────

export interface Game1LobbyServiceOptions {
  pool: Pool;
  schema?: string;
  planService: GamePlanService;
  planRunService: GamePlanRunService;
}

export class Game1LobbyService {
  private readonly pool: Pool;
  private readonly schema: string;
  private readonly planService: GamePlanService;
  private readonly planRunService: GamePlanRunService;

  constructor(options: Game1LobbyServiceOptions) {
    if (!options.pool) {
      throw new DomainError("INVALID_CONFIG", "pool er påkrevd.");
    }
    if (!options.planService) {
      throw new DomainError("INVALID_CONFIG", "planService er påkrevd.");
    }
    if (!options.planRunService) {
      throw new DomainError("INVALID_CONFIG", "planRunService er påkrevd.");
    }
    this.pool = options.pool;
    this.schema = assertSchemaName(options.schema ?? "public");
    this.planService = options.planService;
    this.planRunService = options.planRunService;
  }

  /** @internal — test-hook (følger mønsteret fra GamePlanRunService.forTesting). */
  static forTesting(opts: {
    pool: Pool;
    schema?: string;
    planService: GamePlanService;
    planRunService: GamePlanRunService;
  }): Game1LobbyService {
    const svc = Object.create(Game1LobbyService.prototype) as Game1LobbyService;
    (svc as unknown as { pool: Pool }).pool = opts.pool;
    (svc as unknown as { schema: string }).schema = assertSchemaName(
      opts.schema ?? "public",
    );
    (svc as unknown as { planService: GamePlanService }).planService =
      opts.planService;
    (svc as unknown as {
      planRunService: GamePlanRunService;
    }).planRunService = opts.planRunService;
    return svc;
  }

  // ── public API ─────────────────────────────────────────────────────────

  /**
   * Hovedflyten: returner full lobby-state for en hall i Spill 1.
   *
   * Algoritme:
   *   1) Resolver `businessDate` (Oslo-tz dagens dato) og `nowHHMM`.
   *   2) Forsøk å finne aktiv plan for hallen via `findActivePlanForHall`.
   *      Bruker både direkte hall-binding og GoH-medlemskap (samme
   *      semantikk som `GamePlanRunService.getOrCreateForToday`).
   *   3) Hvis ingen plan → returner `closed`-state med tomt felt.
   *   4) Sjekk om `nowHHMM ∈ [plan.startTime, plan.endTime]`. Hvis ikke,
   *      returner `closed` (men inkluder plan-info så UI kan vise
   *      "Åpner kl 11:00").
   *   5) Hvis innenfor åpningstid:
   *      a) Forsøk `planRunService.findForDay(hall, date)`. Vi kaller IKKE
   *         `getOrCreateForToday` — read-only på public-rute. Hvis ingen
   *         run finnes ennå, oppgir vi position=0 og status=`idle`.
   *      b) Hvis run eksisterer, plukk current/next item fra plan.items
   *         (run.currentPosition er 1-basert).
   *      c) Slå opp scheduled-game-rad for (run.id, position) for å hente
   *         engine-status hvis runden er i gang.
   *   6) Returner `Game1LobbyState` med riktig overall-status.
   *
   * Feil-håndtering:
   *   Service-laget kaster KUN ved kontrakt-feil (ugyldig hallId). Andre
   *   feil (DB-down, korrupte data) propagerer til router-laget som
   *   konverterer til 5xx. Vi har ingen "delvis svar"-modus — caller får
   *   alltid en fullt utfylt state-objekt eller en feil.
   */
  async getLobbyState(
    hallId: string,
    now: Date = new Date(),
  ): Promise<Game1LobbyState> {
    const hall = assertHallId(hallId);
    const businessDate = todayOsloKey(now);
    const nowHHMM = osloHHMM(now);
    const weekday = weekdayFromDateStr(businessDate);

    // 1) Finn aktiv plan for hallen (direkte eller via GoH).
    const plan = await this.findActivePlanForHall(hall, weekday);
    if (!plan) {
      return this.buildClosedState(hall, businessDate, null, null);
    }

    // 2) Sjekk åpningstid. NB: vi bruker rene "HH:MM"-sammenligninger på
    // Oslo-tid — ingen overnight-plans foreløpig (start >= end er
    // forbudt av GamePlanService.create). Hvis dette endres senere må vi
    // også håndtere overnight (`now >= start || now < end`).
    const startMin = timeToMinutes(plan.startTime);
    const endMin = timeToMinutes(plan.endTime);
    const nowMin = timeToMinutes(nowHHMM);
    const withinOpening = nowMin >= startMin && nowMin < endMin;

    if (!withinOpening) {
      return this.buildClosedState(hall, businessDate, plan, null);
    }

    // 3) Innenfor åpningstid — finn run hvis den eksisterer.
    let run: GamePlanRun | null;
    try {
      run = await this.planRunService.findForDay(hall, businessDate);
    } catch (err) {
      // findForDay skal ikke kaste på normale lookups, men være defensiv.
      logger.warn(
        { err, hallId: hall, businessDate },
        "[lobby] planRunService.findForDay kastet — behandler som ingen run",
      );
      run = null;
    }

    // Hvis runden er finished, sett overall=finished men returner med
    // plan-info så UI kan vise "Spilleplanen er ferdig"-melding.
    if (run && run.status === "finished") {
      return {
        hallId: hall,
        businessDate,
        isOpen: true,
        openingTimeStart: plan.startTime,
        openingTimeEnd: plan.endTime,
        planId: plan.id,
        planName: plan.name,
        runId: run.id,
        runStatus: run.status,
        overallStatus: "finished",
        nextScheduledGame: null,
        currentRunPosition: run.currentPosition,
        totalPositions: plan.items.length,
      };
    }

    // 4) Hvis ingen run finnes ennå (master har ikke trykket Start), vis
    // første item i planen som "neste".
    if (!run) {
      const firstItem = plan.items.find((i) => i.position === 1) ?? null;
      const nextGame = firstItem
        ? this.buildNextGameFromItem(firstItem, "idle", null, null, null, null)
        : null;
      return {
        hallId: hall,
        businessDate,
        isOpen: true,
        openingTimeStart: plan.startTime,
        openingTimeEnd: plan.endTime,
        planId: plan.id,
        planName: plan.name,
        runId: null,
        runStatus: null,
        overallStatus: nextGame ? "idle" : "closed",
        nextScheduledGame: nextGame,
        currentRunPosition: 0,
        totalPositions: plan.items.length,
      };
    }

    // 5) Run eksisterer — plukk current/next item fra planen.
    const currentItem =
      plan.items.find((i) => i.position === run.currentPosition) ?? null;

    if (!currentItem) {
      // Defensivt: run peker til ikke-eksisterende posisjon. Sannsynligvis
      // race der admin har slettet en plan-item etter run ble opprettet.
      // Returner closed-state med plan-info så klient ikke krasjer.
      logger.warn(
        {
          hallId: hall,
          businessDate,
          runId: run.id,
          currentPosition: run.currentPosition,
          itemsCount: plan.items.length,
        },
        "[lobby] run.currentPosition matcher ikke plan-items — returnerer closed",
      );
      return {
        hallId: hall,
        businessDate,
        isOpen: true,
        openingTimeStart: plan.startTime,
        openingTimeEnd: plan.endTime,
        planId: plan.id,
        planName: plan.name,
        runId: run.id,
        runStatus: run.status,
        overallStatus: "idle",
        nextScheduledGame: null,
        currentRunPosition: run.currentPosition,
        totalPositions: plan.items.length,
      };
    }

    // 6) Slå opp scheduled-game for (run, position) for å hente engine-status.
    const scheduledGame = await this.findScheduledGameForPosition(
      run.id,
      run.currentPosition,
    );

    let engineStatus: Game1LobbyOverallStatus = "idle";
    let scheduledGameId: string | null = null;
    let scheduledStartTime: string | null = null;
    let scheduledEndTime: string | null = null;
    let actualStartTime: string | null = null;

    if (scheduledGame) {
      engineStatus = mapScheduledGameStatus(scheduledGame.status);
      scheduledGameId = scheduledGame.id;
      scheduledStartTime = asIsoOrNull(scheduledGame.scheduled_start_time);
      scheduledEndTime = asIsoOrNull(scheduledGame.scheduled_end_time);
      actualStartTime = asIsoOrNull(scheduledGame.actual_start_time);
    } else if (run.status === "paused") {
      engineStatus = "paused";
    } else if (run.status === "running") {
      // Run er running men ingen scheduled-game-rad finnes — sannsynligvis
      // mellom rundene (master har advancet posisjon men ikke spawnet
      // engine ennå). Vi rapporterer `idle` så UI viser "venter på neste".
      engineStatus = "idle";
    }

    const nextGame = this.buildNextGameFromItem(
      currentItem,
      engineStatus,
      scheduledGameId,
      scheduledStartTime,
      scheduledEndTime,
      actualStartTime,
    );

    return {
      hallId: hall,
      businessDate,
      isOpen: true,
      openingTimeStart: plan.startTime,
      openingTimeEnd: plan.endTime,
      planId: plan.id,
      planName: plan.name,
      runId: run.id,
      runStatus: run.status,
      overallStatus: engineStatus,
      nextScheduledGame: nextGame,
      currentRunPosition: run.currentPosition,
      totalPositions: plan.items.length,
    };
  }

  // ── interne ────────────────────────────────────────────────────────────

  /**
   * Bygg en `closed`-state. Når plan er null returnerer vi alle plan-felter
   * som null. Når plan er ikke-null inkluderer vi opening-times så UI kan
   * rendre "Åpner kl HH:MM".
   */
  private buildClosedState(
    hallId: string,
    businessDate: string,
    plan: GamePlanWithItems | null,
    nextGame: Game1LobbyNextGame | null,
  ): Game1LobbyState {
    return {
      hallId,
      businessDate,
      isOpen: false,
      openingTimeStart: plan?.startTime ?? null,
      openingTimeEnd: plan?.endTime ?? null,
      planId: plan?.id ?? null,
      planName: plan?.name ?? null,
      runId: null,
      runStatus: null,
      overallStatus: "closed",
      nextScheduledGame: nextGame,
      currentRunPosition: 0,
      totalPositions: plan?.items.length ?? 0,
    };
  }

  private buildNextGameFromItem(
    item: { id: string; position: number; catalogEntry: GameCatalogEntry },
    status: Game1LobbyOverallStatus,
    scheduledGameId: string | null,
    scheduledStartTime: string | null,
    scheduledEndTime: string | null,
    actualStartTime: string | null,
  ): Game1LobbyNextGame {
    return {
      itemId: item.id,
      position: item.position,
      catalogSlug: item.catalogEntry.slug,
      catalogDisplayName: item.catalogEntry.displayName,
      status,
      scheduledGameId,
      scheduledStartTime,
      scheduledEndTime,
      actualStartTime,
    };
  }

  /**
   * Finn aktiv plan for hallen + ukedag. Speiler logikken i
   * `GamePlanRunService.getOrCreateForToday` men er read-only og kaster
   * IKKE NO_MATCHING_PLAN — returnerer null hvis ingen plan dekker.
   *
   * Hall kan dekkes via:
   *   - `plan.hallId === hall` (direkte binding), ELLER
   *   - `plan.groupOfHallsId IN (groups hall er aktivt medlem av)`
   */
  private async findActivePlanForHall(
    hallId: string,
    weekday: Weekday,
  ): Promise<GamePlanWithItems | null> {
    const goHIds = await this.findGoHIdsForHall(hallId);

    const candidates = await this.planService.list({
      hallId,
      groupOfHallsIds: goHIds.length > 0 ? goHIds : undefined,
      isActive: true,
      limit: 50,
    });
    // Dedup på id (defensivt — XOR-constraint i DB skal hindre dette).
    const seen = new Set<string>();
    const unique = candidates.filter((p) => {
      if (seen.has(p.id)) return false;
      seen.add(p.id);
      return true;
    });
    const matched = unique.find((p) =>
      (p.weekdays as readonly string[]).includes(weekday),
    );
    if (!matched) return null;
    // Last full plan (med items + catalog-entries).
    const plan = await this.planService.getById(matched.id);
    return plan ?? null;
  }

  private async findGoHIdsForHall(hallId: string): Promise<string[]> {
    const { rows } = await this.pool.query<{ group_id: string }>(
      `SELECT m.group_id
       FROM "${this.schema}"."app_hall_group_members" m
       INNER JOIN "${this.schema}"."app_hall_groups" g ON g.id = m.group_id
       WHERE m.hall_id = $1
         AND g.deleted_at IS NULL
         AND g.status = 'active'`,
      [hallId],
    );
    return rows.map((r) => r.group_id);
  }

  /**
   * Slå opp scheduled-game for (run.id, position). Vi gjør et raw SELECT
   * heller enn å ruta gjennom Game1MasterControlService — disse feltene er
   * stabile og en lobby-fetch skal være billig.
   *
   * Returnerer null hvis ingen rad finnes (runden har ikke blitt spawnet
   * ennå, eller raden er slettet).
   */
  private async findScheduledGameForPosition(
    runId: string,
    position: number,
  ): Promise<ScheduledGameForLobbyRow | null> {
    const { rows } = await this.pool.query<ScheduledGameForLobbyRow>(
      `SELECT id, status, scheduled_start_time, scheduled_end_time,
              actual_start_time, catalog_entry_id
       FROM "${this.schema}"."app_game1_scheduled_games"
       WHERE plan_run_id = $1 AND plan_position = $2
       LIMIT 1`,
      [runId, position],
    );
    return rows[0] ?? null;
  }
}

// ── input-validering (samme mønster som GamePlanService) ────────────────

function assertSchemaName(schema: string): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(schema)) {
    throw new DomainError("INVALID_CONFIG", "Ugyldig schema-navn.");
  }
  return schema;
}

function assertHallId(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new DomainError("INVALID_INPUT", "hallId er påkrevd.");
  }
  return value.trim();
}

// Eksporter også en re-eksport av GamePlan (Object.create-pattern bruker
// dette i tester for å bygge stub-services).
export type { GamePlan, GamePlanWithItems };
