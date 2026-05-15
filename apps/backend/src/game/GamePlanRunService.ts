/**
 * Fase 1 (2026-05-07): GamePlanRunService — runtime-state for spilleplan.
 *
 * Tabell: `app_game_plan_run`. Service-laget håndterer:
 *   - getOrCreateForToday: idempotent — opprett "idle"-rad hvis ingen finnes
 *     for (hall, business_date), ellers returner eksisterende.
 *   - start: idle → running, set started_at + master_user_id, current_position=1.
 *   - advanceToNext: inkrementer current_position. Hvis catalog-entry på
 *     ny posisjon krever jackpot-setup og override mangler, returner
 *     `jackpotSetupRequired=true` (run flyttes ikke før master submitter).
 *     Hvis vi går forbi siste posisjon → status=finished.
 *   - setJackpotOverride: lagrer trekk + premier per posisjon for jackpot-
 *     popup (master fyller i UI når jackpot-spill skal starte).
 *   - pause/resume/finish: status-overganger.
 *
 * Status-overganger:
 *   idle → running (via start)
 *   running ↔ paused (via pause/resume)
 *   running/paused → finished (via finish OR advanceToNext-past-end)
 *   idle → finished (force-finish, OK)
 *
 * Out-of-scope for Fase 1:
 *   - Routes (Fase 3)
 *   - Master-dashbord-kobling (Fase 3)
 *   - Multi-hall coordination (allerede dekket av eksisterende
 *     Game1HallReadyService osv. — denne service-en er en _override_-laget
 *     for plan-templates).
 */

import { randomUUID } from "node:crypto";
import { Pool } from "pg";

import { DomainError } from "../errors/DomainError.js";
import { formatOsloDateKey } from "../util/osloTimezone.js";
import { logger as rootLogger } from "../util/logger.js";
import type { AuditLogService } from "../compliance/AuditLogService.js";
import type { GameCatalogService } from "./GameCatalogService.js";
import type { GamePlanService } from "./GamePlanService.js";
import type { InlineCleanupHook } from "./GamePlanRunCleanupService.js";
import type {
  AdvanceToNextResult,
  GamePlanRun,
  GamePlanRunStatus,
  GamePlanWithItems,
  JackpotOverride,
} from "./gamePlan.types.js";
import type { TicketColor } from "./gameCatalog.types.js";
import { TICKET_COLOR_VALUES } from "./gameCatalog.types.js";

const logger = rootLogger.child({ module: "game-plan-run-service" });

const VALID_TICKET_COLORS = new Set<TicketColor>(TICKET_COLOR_VALUES);
// Trekk-range — vi tillater 1..90 selv om Spill 1 er 1..75. Forskjellige
// spill-typer i kataloget kan ha ulikt range. Mer detaljert validering må
// flyttes til den enkelte spill-engine i Fase 3.
const MIN_DRAW = 1;
const MAX_DRAW = 90;

// ── input-validering ────────────────────────────────────────────────────

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

function assertBusinessDate(value: unknown): string {
  // Aksepterer Date eller "YYYY-MM-DD"-streng. Returnerer "YYYY-MM-DD"
  // (Oslo-tz). Vi unngår å regne tz-konvertering selv — caller må passe
  // på at de sender en Oslo-tz-dato. Dette matcher mønsteret i
  // CloseDayService og andre eksisterende services.
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new DomainError("INVALID_INPUT", "businessDate er ugyldig dato.");
    }
    const yyyy = value.getFullYear();
    const mm = String(value.getMonth() + 1).padStart(2, "0");
    const dd = String(value.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      throw new DomainError(
        "INVALID_INPUT",
        "businessDate må være Date eller 'YYYY-MM-DD'.",
      );
    }
    return trimmed;
  }
  throw new DomainError(
    "INVALID_INPUT",
    "businessDate må være Date eller 'YYYY-MM-DD'.",
  );
}

function assertNotPastDate(businessDate: string): void {
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, "0");
  const dd = String(today.getDate()).padStart(2, "0");
  const todayStr = `${yyyy}-${mm}-${dd}`;
  if (businessDate < todayStr) {
    throw new DomainError(
      "INVALID_INPUT",
      `businessDate ${businessDate} er i fortiden — kun i dag eller senere er tillatt.`,
    );
  }
}

function assertJackpotOverride(
  raw: unknown,
  allowedColors: Set<TicketColor>,
): JackpotOverride {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new DomainError(
      "INVALID_INPUT",
      "override må være et objekt med draw + prizesCents.",
    );
  }
  const obj = raw as Record<string, unknown>;
  const drawN = Number(obj.draw);
  if (!Number.isFinite(drawN) || !Number.isInteger(drawN)) {
    throw new DomainError(
      "INVALID_INPUT",
      "override.draw må være heltall.",
    );
  }
  if (drawN < MIN_DRAW || drawN > MAX_DRAW) {
    throw new DomainError(
      "INVALID_INPUT",
      `override.draw må være mellom ${MIN_DRAW} og ${MAX_DRAW}.`,
    );
  }
  if (
    !obj.prizesCents ||
    typeof obj.prizesCents !== "object" ||
    Array.isArray(obj.prizesCents)
  ) {
    throw new DomainError(
      "INVALID_INPUT",
      "override.prizesCents må være et objekt.",
    );
  }
  const prizes: Partial<Record<TicketColor, number>> = {};
  for (const [k, v] of Object.entries(obj.prizesCents as Record<string, unknown>)) {
    if (!VALID_TICKET_COLORS.has(k as TicketColor)) {
      throw new DomainError(
        "INVALID_INPUT",
        `override.prizesCents.${k} er ikke en gyldig bongfarge.`,
      );
    }
    if (!allowedColors.has(k as TicketColor)) {
      throw new DomainError(
        "INVALID_INPUT",
        `override.prizesCents.${k} matcher ikke catalog-game.ticketColors.`,
      );
    }
    const n = Number(v);
    if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
      throw new DomainError(
        "INVALID_INPUT",
        `override.prizesCents.${k} må være positivt heltall (øre).`,
      );
    }
    prizes[k as TicketColor] = n;
  }
  if (Object.keys(prizes).length === 0) {
    throw new DomainError(
      "INVALID_INPUT",
      "override.prizesCents må ha minst én farge.",
    );
  }
  return { draw: drawN, prizesCents: prizes };
}

function asIso(value: Date | string): string {
  return typeof value === "string" ? value : value.toISOString();
}

function asIsoOrNull(value: Date | string | null): string | null {
  if (value === null || value === undefined) return null;
  return asIso(value);
}

/**
 * F4 (E2E-verification 2026-Q3): tidssone-bug-fix — pg-driveren returnerer
 * `business_date`-kolonnen som JS Date hvor moment-i-tid er **server-lokal
 * midnatt** for den lagrede DATE-en. På en server med Europe/Oslo-tz blir
 * det `00:00 Oslo-tid`, som i UTC er forrige kalenderdag (22:00-23:00 UTC,
 * avhengig av DST).
 *
 * Tidligere versjon brukte `getUTCFullYear/Month/Date` på dette objektet
 * og returnerte da feil dato i grenseperioden 22:00-00:00 UTC. F4-rapporten
 * dokumenterte at `business_date` "2026-05-09" ble formattert til
 * "2026-05-08" ved nattpoll i Oslo-vinduet 00:00-02:00.
 *
 * Riktig oppførsel: bruk `formatOsloDateKey` som tolker moment-i-tid via
 * `Intl.DateTimeFormat({ timeZone: 'Europe/Oslo' })`. Det gir korrekt
 * kalenderdato uavhengig av server-host-tz og DST.
 */
function dateRowToString(value: unknown): string {
  if (typeof value === "string") {
    // Postgres returnerer 'YYYY-MM-DD' eller full ISO — kapp til 10 tegn.
    return value.length >= 10 ? value.slice(0, 10) : value;
  }
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      return "0000-00-00";
    }
    return formatOsloDateKey(value);
  }
  return "0000-00-00";
}

function isUniqueViolation(err: unknown): boolean {
  if (err && typeof err === "object" && "code" in err) {
    return (err as { code: unknown }).code === "23505";
  }
  return false;
}

// ── row mapping ─────────────────────────────────────────────────────────

interface GamePlanRunRow {
  id: string;
  plan_id: string;
  hall_id: string;
  business_date: unknown;
  current_position: number;
  status: string;
  jackpot_overrides_json: unknown;
  started_at: Date | string | null;
  finished_at: Date | string | null;
  master_user_id: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

function parseJackpotOverrides(
  raw: unknown,
): Record<string, JackpotOverride> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, JackpotOverride> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!v || typeof v !== "object" || Array.isArray(v)) continue;
    const obj = v as Record<string, unknown>;
    const drawN = Number(obj.draw);
    if (!Number.isFinite(drawN) || !Number.isInteger(drawN)) continue;
    let prizesRaw: unknown = obj.prizesCents;
    // Tolerer både camelCase og snake_case fra DB.
    if (prizesRaw === undefined) prizesRaw = obj.prizes_cents;
    if (!prizesRaw || typeof prizesRaw !== "object" || Array.isArray(prizesRaw)) {
      continue;
    }
    const prizes: Partial<Record<TicketColor, number>> = {};
    for (const [pk, pv] of Object.entries(
      prizesRaw as Record<string, unknown>,
    )) {
      if (!VALID_TICKET_COLORS.has(pk as TicketColor)) continue;
      const n = Number(pv);
      if (Number.isFinite(n) && Number.isInteger(n) && n >= 0) {
        prizes[pk as TicketColor] = n;
      }
    }
    out[k] = { draw: drawN, prizesCents: prizes };
  }
  return out;
}

function mapRow(row: GamePlanRunRow): GamePlanRun {
  const status = row.status as GamePlanRunStatus;
  return {
    id: row.id,
    planId: row.plan_id,
    hallId: row.hall_id,
    businessDate: dateRowToString(row.business_date),
    currentPosition: Number(row.current_position),
    status,
    jackpotOverrides: parseJackpotOverrides(row.jackpot_overrides_json),
    startedAt: asIsoOrNull(row.started_at),
    finishedAt: asIsoOrNull(row.finished_at),
    masterUserId: row.master_user_id,
    createdAt: asIso(row.created_at),
    updatedAt: asIso(row.updated_at),
  };
}

// ── service ─────────────────────────────────────────────────────────────

export interface GamePlanRunServiceOptions {
  pool: Pool;
  schema?: string;
  planService: GamePlanService;
  catalogService: GameCatalogService;
  auditLogService?: AuditLogService | null;
  /**
   * Optional self-healing hook (Pilot Q3 2026). Bound at app-boot to
   * `GamePlanRunCleanupService.cleanupStaleRunsForHall` so that
   * `getOrCreateForToday` can auto-finish gårsdagens stale runs INLINE
   * before returning today's row. Without this hook the cron-job (kjøres
   * 03:00 Oslo) is the only safety-net.
   *
   * Why optional: tests construct the service via `forTesting` without a
   * cleanup-service, and we want backwards-compat for any caller that
   * builds the service stand-alone (e.g. migrations / scripts).
   */
  inlineCleanupHook?: InlineCleanupHook | null;
  /**
   * Pilot Q3 2026 (2026-05-15): Lobby-broadcaster for spiller-shell-
   * oppdatering ved plan-run-status-overgang til `finished`. Tobias-
   * rapport 2026-05-15: "Etter at runden var fullført viser fortsatt
   * 'Neste spill: Bingo' i ca 2 min". Når plan-run.status flippes til
   * `finished` (via `finish()` eller `advanceToNext()`-past-end) skal
   * spiller-shellen umiddelbart se "Ferdig for dagen" istedenfor å
   * vente på 3s/10s-poll.
   *
   * Fire-and-forget — feil propagerer ikke til state-mutering. Når
   * null/undefined skipper service-en stille (bakoverkompat for tester).
   */
  lobbyBroadcaster?: {
    broadcastForHall(hallId: string): Promise<void>;
  } | null;
}

export class GamePlanRunService {
  private readonly pool: Pool;
  private readonly schema: string;
  private readonly planService: GamePlanService;
  private readonly catalogService: GameCatalogService;
  private auditLogService: AuditLogService | null;
  private inlineCleanupHook: InlineCleanupHook | null;
  /**
   * Pilot Q3 2026 (2026-05-15): broadcaster for spiller-shell ved
   * plan-run-finish. Null = silent skip (bakoverkompat).
   */
  private lobbyBroadcaster: {
    broadcastForHall(hallId: string): Promise<void>;
  } | null;

  constructor(options: GamePlanRunServiceOptions) {
    this.pool = options.pool;
    this.schema = assertSchemaName(options.schema ?? "public");
    this.planService = options.planService;
    this.catalogService = options.catalogService;
    this.auditLogService = options.auditLogService ?? null;
    this.inlineCleanupHook = options.inlineCleanupHook ?? null;
    this.lobbyBroadcaster = options.lobbyBroadcaster ?? null;
  }

  /** @internal — test-hook. */
  static forTesting(opts: {
    pool: Pool;
    schema?: string;
    planService: GamePlanService;
    catalogService: GameCatalogService;
    auditLogService?: AuditLogService | null;
    inlineCleanupHook?: InlineCleanupHook | null;
  }): GamePlanRunService {
    const svc = Object.create(
      GamePlanRunService.prototype,
    ) as GamePlanRunService;
    (svc as unknown as { pool: Pool }).pool = opts.pool;
    (svc as unknown as { schema: string }).schema = assertSchemaName(
      opts.schema ?? "public",
    );
    (svc as unknown as {
      planService: GamePlanService;
    }).planService = opts.planService;
    (svc as unknown as {
      catalogService: GameCatalogService;
    }).catalogService = opts.catalogService;
    (svc as unknown as {
      auditLogService: AuditLogService | null;
    }).auditLogService = opts.auditLogService ?? null;
    (svc as unknown as {
      inlineCleanupHook: InlineCleanupHook | null;
    }).inlineCleanupHook = opts.inlineCleanupHook ?? null;
    (svc as unknown as {
      lobbyBroadcaster: {
        broadcastForHall(hallId: string): Promise<void>;
      } | null;
    }).lobbyBroadcaster = null;
    return svc;
  }

  /**
   * Pilot Q3 2026 (2026-05-15): late-binding for lobby-broadcaster.
   * Brukes hvis broadcaster konstrueres etter service (eller i tester).
   */
  setLobbyBroadcaster(
    broadcaster: {
      broadcastForHall(hallId: string): Promise<void>;
    } | null,
  ): void {
    this.lobbyBroadcaster = broadcaster;
  }

  /**
   * Pilot Q3 2026 (2026-05-15): fire-and-forget lobby-broadcast for én
   * hall etter plan-run-finish. Best-effort — broadcaster-feil logges
   * aldri til caller, og state-mutering ruller ikke tilbake.
   *
   * Called fra `finish()` og `advanceToNext()` (når past-end → finished).
   * Skipper stille hvis broadcaster ikke er wired (tester / bakoverkompat).
   */
  private fireLobbyBroadcastForFinish(hallId: string): void {
    if (!this.lobbyBroadcaster) return;
    const broadcaster = this.lobbyBroadcaster;
    try {
      void Promise.resolve(broadcaster.broadcastForHall(hallId)).catch(
        (err) => {
          logger.warn(
            { err, hallId },
            "[plan-run] lobby-broadcast etter finish feilet — best-effort",
          );
        },
      );
    } catch (err) {
      logger.warn(
        { err, hallId },
        "[plan-run] lobby-broadcast etter finish kastet synkront — best-effort",
      );
    }
  }

  setAuditLogService(service: AuditLogService | null): void {
    this.auditLogService = service ?? null;
  }

  /**
   * Bind the inline cleanup-hook post-construction. Used by `index.ts` so
   * we can construct `GamePlanRunService` BEFORE `GamePlanRunCleanupService`
   * exists — otherwise we'd have a circular ordering constraint at app-boot.
   */
  setInlineCleanupHook(hook: InlineCleanupHook | null): void {
    this.inlineCleanupHook = hook ?? null;
  }

  private table(): string {
    return `"${this.schema}"."app_game_plan_run"`;
  }

  // ── reads ─────────────────────────────────────────────────────────────

  /**
   * Hent aktiv (idle/running/paused) eller siste run for (hallId,
   * businessDate). Ingen oppretting — caller må selv kalle
   * `getOrCreateForToday` hvis de vil ha en idempotent create.
   */
  async findForDay(
    hallId: string,
    businessDate: Date | string,
  ): Promise<GamePlanRun | null> {
    const hall = assertHallId(hallId);
    const dateStr = assertBusinessDate(businessDate);
    const { rows } = await this.pool.query<GamePlanRunRow>(
      `SELECT id, plan_id, hall_id, business_date, current_position, status,
              jackpot_overrides_json, started_at, finished_at, master_user_id,
              created_at, updated_at
       FROM ${this.table()}
       WHERE hall_id = $1 AND business_date = $2::date`,
      [hall, dateStr],
    );
    return rows[0] ? mapRow(rows[0]) : null;
  }

  /**
   * FIX-1 (2026-05-14): Finn stuck plan-runs for en gitt (hall, businessDate).
   *
   * En "stuck" plan-run er en rad hvor:
   *   1. `status = 'running'`
   *   2. INGEN linkede `app_game1_scheduled_games` har en aktiv status
   *      (`scheduled`/`purchase_open`/`ready_to_start`/`running`/`paused`).
   *
   * Bakgrunn — fra OBS-6 DB-auditor (`audit:db --quick`):
   *   Master starter en runde, men noe går galt mellom plan-run-state-machinen
   *   og scheduled-game-spawnet (eks. backend-crash, race-condition, eller
   *   stop-flow som ikke kalte `planRunService.finish`). Resultatet er at
   *   plan-run står i `running` med 0 aktive scheduled-games — klient sitter
   *   fast og venter på neste runde som aldri spawnes.
   *
   * Brukes av `MasterActionService.start()` og `advanceToNext()` til å auto-
   * reconcile slike rader FØR ny runde startes (defense-in-depth utenfor
   * eksisterende `GamePlanRunCleanupService` som kun rydder gårsdagens
   * rader).
   *
   * Query mirror-er OBS-6 audit:db-spørringen (`stuck-plan-run`-id i
   * `apps/backend/scripts/audit-db.queries.json`) for konsistens.
   */
  async findStuck(input: {
    hallId: string;
    businessDate: Date | string;
  }): Promise<GamePlanRun[]> {
    const hall = assertHallId(input.hallId);
    const dateStr = assertBusinessDate(input.businessDate);
    const { rows } = await this.pool.query<GamePlanRunRow>(
      `SELECT pr.id, pr.plan_id, pr.hall_id, pr.business_date,
              pr.current_position, pr.status, pr.jackpot_overrides_json,
              pr.started_at, pr.finished_at, pr.master_user_id,
              pr.created_at, pr.updated_at
         FROM ${this.table()} pr
         LEFT JOIN "${this.schema}"."app_game1_scheduled_games" sg
           ON sg.plan_run_id = pr.id
          AND sg.status IN (
            'scheduled',
            'purchase_open',
            'ready_to_start',
            'running',
            'paused'
          )
        WHERE pr.hall_id = $1
          AND pr.business_date = $2::date
          AND pr.status = 'running'
          AND sg.id IS NULL
        GROUP BY pr.id, pr.plan_id, pr.hall_id, pr.business_date,
                 pr.current_position, pr.status, pr.jackpot_overrides_json,
                 pr.started_at, pr.finished_at, pr.master_user_id,
                 pr.created_at, pr.updated_at`,
      [hall, dateStr],
    );
    return rows.map(mapRow);
  }

  /**
   * Tobias-direktiv 2026-05-15 (header-bug fix):
   *   "Uavhengig av hvilken status agentene har skal teksten ALLTID være FØR
   *    spillet starter: 'Neste spill: {neste spill på lista}'."
   *
   *   Master-konsoll viste "Neste spill" (uten navn) direkte etter dev:nuke
   *   fordi ingen plan-run eksisterte ennå — aggregator's `buildPlanMeta`
   *   returnerte null fordi `plan` var null. Dette helper-en lar aggregator
   *   slå opp den aktive planen for (hall, businessDate) UTEN å opprette en
   *   plan-run, slik at `catalogDisplayName` kan settes til items[0] og
   *   header viser "Neste spill: Bingo" fra første poll.
   *
   * Returnerer `null` hvis ingen plan dekker (hall, weekday). Kaster aldri
   * `NO_MATCHING_PLAN` (det er kun for write-paths som `getOrCreateForToday`).
   *
   * Implementasjon speiler kandidat-oppslag i `getOrCreateForToday`
   * (linje 614-642 ved skriving) — samme sortering og match-logikk slik at
   * read-pathen alltid returnerer SAMME plan som write-pathen ville valgt.
   */
  async findActivePlanForDay(
    hallId: string,
    businessDate: Date | string,
  ): Promise<GamePlanWithItems | null> {
    const hall = assertHallId(hallId);
    const dateStr = assertBusinessDate(businessDate);
    const weekdayKey = this.weekdayFromDateStr(dateStr);
    const goHIds = await this.findGoHIdsForHall(hall);
    const candidates = await this.planService.list({
      hallId: hall,
      groupOfHallsIds: goHIds.length > 0 ? goHIds : undefined,
      isActive: true,
      limit: 50,
    });
    // Dedup på id (en plan kan i teorien matche begge filtere — selv om
    // CHECK constraint sier XOR, er defensiv dedup gratis). Samme mønster
    // som `getOrCreateForToday`.
    const seen = new Set<string>();
    const unique = candidates.filter((p) => {
      if (seen.has(p.id)) return false;
      seen.add(p.id);
      return true;
    });
    const matched = unique.find((p) =>
      (p.weekdays as readonly string[]).includes(weekdayKey),
    );
    if (!matched) {
      return null;
    }
    // Hent plan med items inline (planService.list returnerer kun meta).
    return this.planService.getById(matched.id);
  }

  /**
   * Finn alle aktive group-of-halls (`app_hall_groups`) som hallen er
   * medlem av. Brukes til å finne GoH-baserte planer som dekker hallen
   * (en plan kan være bundet til en GoH istedet for en konkret hall).
   *
   * Pilot-fix 2026-05-08: før denne ble lagt til matchet
   * `getOrCreateForToday` kun planer der `plan.hallId === hall`. Tobias'
   * pilot-plan er GoH-bundet (`hallId=null, groupOfHallsId='06b1c6ce-...'`)
   * og blokkerte derfor pilot-flow med `NO_MATCHING_PLAN`.
   *
   * Henter kun grupper hvor `g.deleted_at IS NULL` og `g.status = 'active'`
   * — samme filter som `GamePlanEngineBridge.resolveGroupHallId`.
   */
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
   * Idempotent create. Hvis ingen run finnes for (hall, businessDate)
   * opprettes en idle-rad bundet til en plan. Hvis flere planer matcher
   * (hall + ukedag) tar service-en den første aktive (sortert på navn).
   *
   * GoH-matching (2026-05-08): planer kan være bundet til ENTEN
   * `plan.hallId === hall` ELLER `plan.groupOfHallsId IN (GoH-er hall er
   * medlem av)`. Begge typer hentes i samme spørring (filter.hallId +
   * filter.groupOfHallsIds OR-es), dedup på `id` etterpå.
   *
   * Hvis ingen plan finnes som dekker (hall, weekday) kastes
   * `NO_MATCHING_PLAN`.
   *
   * F-Plan-Reuse (2026-05-09): hvis eksisterende run for dagens
   * businessDate er `status='finished'` (master har manuelt finishet
   * eller recovery-cleanup har lukket den), skal vi tillate master å
   * starte en ny runde samme dag. Vi DELETE-r den finished-raden og
   * INSERT-er en ny idle-rad med ny ID.
   *
   * BUG E auto-advance (2026-05-14, Tobias-direktiv): når vi erstatter
   * en finished run, beregner vi `current_position` ut fra forrige
   * run-s posisjon, IKKE alltid `1`:
   *   - `previousPosition < plan.items.length` → `nextPosition = prev + 1`
   *     (spillet går videre til neste i spilleplanen)
   *   - `previousPosition >= plan.items.length` → `nextPosition = 1`
   *     (planen er ferdig — wrap til start for ny syklus)
   *
   * Tobias-direktiv: "Hvert spill spilles kun en gang deretter videre
   * til nytt spill." Uten auto-advance kjørte Bingo (pos 1) i loop
   * fordi DELETE+INSERT alltid resatte til position=1.
   *
   * Hvorfor DELETE+INSERT vs. UPDATE-i-place:
   *   1. UNIQUE(hall_id, business_date) blokkerer en parallell INSERT
   *      uten å fjerne den gamle først.
   *   2. UPDATE av primary-key (id) ville kreve CASCADE-håndtering på
   *      `app_game1_scheduled_games.plan_run_id` (FK med ON DELETE SET
   *      NULL). DELETE er mer eksplisitt: scheduled-games for forrige
   *      run dropper plan_run_id-link (de er allerede merket
   *      finished/cancelled av recovery-flow eller engine-completion).
   *   3. Audit-trail forbedres: vi får én create-event per "logisk
   *      runde" (forrige run sin lifecycle-events ligger fremdeles i
   *      audit-log med den gamle ID-en).
   *
   * Eksisterende non-finished status (idle/running/paused) returneres
   * uendret — det er den gamle idempotency-semantikken.
   */
  async getOrCreateForToday(
    hallId: string,
    businessDate: Date | string,
  ): Promise<GamePlanRun> {
    const hall = assertHallId(hallId);
    const dateStr = assertBusinessDate(businessDate);
    assertNotPastDate(dateStr);

    // Pilot Q3 2026 self-healing: BEFORE we look at today's row, sweep
    // away any stale running/paused runs from yesterday for THIS hall.
    // The cron runs nightly at 03:00 Oslo, but if the cron failed or the
    // backend just booted, this inline call ensures the master-konsoll
    // never sees STALE_PLAN_RUN-warnings from gårsdagens leftover state.
    //
    // Hook may be null in tests / stand-alone scripts; treat as no-op.
    // Failures inside the hook are best-effort — we log + continue so a
    // cleanup glitch can never block today's run from being created.
    if (this.inlineCleanupHook) {
      try {
        await this.inlineCleanupHook(hall);
      } catch (err) {
        logger.warn(
          { err, hallId: hall },
          "[pilot-q3] inline self-heal failed — continuing with getOrCreateForToday",
        );
      }
    }

    const existing = await this.findForDay(hall, dateStr);
    if (existing && existing.status !== "finished") {
      // Active run (idle/running/paused) — return as-is (idempotent).
      return existing;
    }

    // F-Plan-Reuse (2026-05-09): if a finished run exists for the same
    // business-date, delete it so we can create a fresh idle run. We
    // capture the previous run's id for audit-trail correlation.
    //
    // BUG E auto-advance (2026-05-14, Tobias-direktiv): tidligere tok vi
    // DELETE → INSERT med `current_position=1` uavhengig av hvor langt
    // forrige run kom. Resultatet: master måtte starte Bingo (position=1)
    // 2-3 ganger før den endelig "kom seg videre" — fordi `finished` ble
    // resatt til posisjon 1 hver gang. Tobias-rapport 2026-05-14:
    //   "Hvert spill spilles kun en gang deretter videre til nytt spill."
    //
    // Fix: capture `previousPosition` FØR DELETE og bruk den til å beregne
    // `nextPosition` på den nye plan-run-raden. Logikk:
    //   - Hvis `previousPosition < plan.items.length` → `nextPosition = prev + 1`
    //   - Hvis `previousPosition >= plan.items.length` → `nextPosition = 1`
    //     (wrap/cycle — siste spill ferdig, plan repeteres)
    let previousRunId: string | null = null;
    let previousPosition: number | null = null;
    if (existing && existing.status === "finished") {
      // Defensive guard: only delete if status is actually finished. We
      // re-check the WHERE-clause in the DELETE itself so a race that
      // resurrects the row between findForDay and DELETE is safe (the
      // DELETE matches zero rows and we fall through to a fresh
      // findForDay below).
      previousRunId = existing.id;
      previousPosition = existing.currentPosition;
      const { rowCount } = await this.pool.query(
        `DELETE FROM ${this.table()}
         WHERE id = $1 AND status = 'finished'`,
        [existing.id],
      );
      if ((rowCount ?? 0) === 0) {
        // Race-loser: someone resurrected the row (e.g. UPDATE status).
        // Re-fetch and return whatever we now find. If it became
        // non-finished, that's the active run and caller gets it.
        const racyResurrected = await this.findForDay(hall, dateStr);
        if (racyResurrected && racyResurrected.status !== "finished") {
          return racyResurrected;
        }
        // Still finished after race? Fall through to attempt INSERT
        // again — the unique-violation-handler below will sort it out.
      }
    }

    // Finn matchende plan. Vi henter alle aktive planer som enten:
    //   - er bundet direkte til hall, ELLER
    //   - er bundet til en GoH som hall er medlem av
    // og velger første som matcher ukedag. Listen er allerede sortert
    // på navn ASC (sekundært createdAt ASC), så "første" er stabil.
    const weekdayKey = this.weekdayFromDateStr(dateStr);
    const goHIds = await this.findGoHIdsForHall(hall);
    const candidates = await this.planService.list({
      hallId: hall,
      groupOfHallsIds: goHIds.length > 0 ? goHIds : undefined,
      isActive: true,
      limit: 50,
    });
    // Dedup på id (en plan kan i teorien matche begge filtere — selv om
    // CHECK constraint sier XOR, er defensiv dedup gratis).
    const seen = new Set<string>();
    const unique = candidates.filter((p) => {
      if (seen.has(p.id)) return false;
      seen.add(p.id);
      return true;
    });
    const matched = unique.find((p) =>
      (p.weekdays as readonly string[]).includes(weekdayKey),
    );
    if (!matched) {
      throw new DomainError(
        "NO_MATCHING_PLAN",
        `Ingen aktiv plan dekker (hall=${hall}, weekday=${weekdayKey}).`,
      );
    }

    // BUG E auto-advance (2026-05-14): beregn `nextPosition`.
    //
    // KORRIGERT spec (Tobias 2026-05-14 10:17): "Plan-completed beats stengetid".
    // Selv om bingohall fortsatt er åpen (innenfor `plan.start_time`-`plan.end_time`),
    // skal master IKKE kunne starte ny plan-run når plan er fullført for dagen.
    // Spillet er over for denne dagen — vent til neste dag.
    //
    // Tre tilfeller:
    //   1. Ingen forrige finished run (`previousPosition === null`)
    //      → start på posisjon 1 (eksisterende oppførsel).
    //   2. Forrige posisjon < antall plan-items
    //      → advance til neste posisjon (`previousPosition + 1`).
    //      Eks: forrige finished på pos 1 (Bingo) → ny på pos 2 (1000-spill).
    //   3. Forrige posisjon >= antall plan-items (plan fullført)
    //      → AVVIS med `PLAN_COMPLETED_FOR_TODAY` (INGEN wrap).
    //      Master må vente til neste dag for å starte ny plan-syklus.
    //
    // `planService.list` returnerer `GamePlan[]` (uten items) — vi må
    // kalle `getById(matched.id)` for å få full `GamePlanWithItems`.
    // getById har sin egen query mot `app_game_plan_item` så vi bærer
    // én ekstra round-trip kun ved finished-replay (ikke vanlig path).
    let nextPosition = 1;
    let autoAdvanced = false;
    let planItemCount = 0;
    if (previousPosition !== null) {
      const planWithItems = await this.planService.getById(matched.id);
      planItemCount = planWithItems?.items?.length ?? 0;
      if (planItemCount > 0 && previousPosition < planItemCount) {
        nextPosition = previousPosition + 1;
        autoAdvanced = true;
      } else if (planItemCount > 0 && previousPosition >= planItemCount) {
        // Plan-completed-state — IKKE wrap. Tobias-direktiv 2026-05-14 10:17.
        // Master må vente til neste dag for å starte ny plan-syklus.
        throw new DomainError(
          "PLAN_COMPLETED_FOR_TODAY",
          `Spilleplan ferdig for i dag (siste posisjon ${previousPosition} av ${planItemCount} fullført). Vent til neste dag for å starte ny plan-syklus.`,
        );
      }
      // else: plan har 0 items → defensive fallback til nextPosition=1
    }

    const id = randomUUID();
    try {
      await this.pool.query(
        `INSERT INTO ${this.table()}
           (id, plan_id, hall_id, business_date, current_position, status, jackpot_overrides_json)
         VALUES ($1, $2, $3, $4::date, $5, 'idle', '{}'::jsonb)`,
        [id, matched.id, hall, dateStr, nextPosition],
      );
    } catch (err) {
      if (isUniqueViolation(err)) {
        // Race: noen andre opprettet en run mellom findForDay og INSERT.
        const racy = await this.findForDay(hall, dateStr);
        if (racy) return racy;
      }
      throw err;
    }
    // Audit-trail forbedring 2026-05-08 (oppfølger #1011): inkluder
    // `bindingType` ("direct" vs. "group") og `matchedGroupId` så
    // Lotteritilsynet-sporingen viser om runen ble matchet via
    // direct-hall-binding eller via GoH-medlemskap. Dette ble lagt til
    // som del av isMaster-fix-en for å gjøre GoH-bundne planer synlige
    // i audit-loggen. `matchedGroupId` er null for direct-bundne planer.
    //
    // F-Plan-Reuse (2026-05-09): når runen erstatter en finished run
    // (samme hall + business_date), inkluderer vi `previousRunId` så
    // audit-traceability fra forrige til ny runde er eksplisitt.
    //
    // BUG E auto-advance (2026-05-14): når vi advancer fra forrige
    // posisjon, inkluderer vi `previousPosition` og `newPosition` så
    // Lotteritilsynet kan rekonstruere full plan-sekvens. `autoAdvanced`
    // boolean lar ops filtrere på sekvens-progresjon vs wrap/start-på-nytt.
    void this.audit({
      actorId: "system",
      actorType: "SYSTEM",
      action: previousRunId
        ? "game_plan_run.recreate_after_finish"
        : "game_plan_run.create",
      resourceId: id,
      details: {
        planId: matched.id,
        hallId: hall,
        businessDate: dateStr,
        bindingType: matched.hallId === hall ? "direct" : "group",
        matchedGroupId: matched.groupOfHallsId ?? null,
        ...(previousRunId ? { previousRunId } : {}),
        ...(previousPosition !== null
          ? {
              previousPosition,
              newPosition: nextPosition,
              autoAdvanced,
              planItemCount,
            }
          : {}),
      },
    });
    const created = await this.findForDay(hall, dateStr);
    if (!created) {
      throw new DomainError(
        "GAME_PLAN_RUN_NOT_FOUND",
        "Run forsvant rett etter create.",
      );
    }
    return created;
  }

  // ── status-overganger ─────────────────────────────────────────────────

  async start(
    hallId: string,
    businessDate: Date | string,
    masterUserId: string,
  ): Promise<GamePlanRun> {
    const hall = assertHallId(hallId);
    const dateStr = assertBusinessDate(businessDate);
    if (typeof masterUserId !== "string" || !masterUserId.trim()) {
      throw new DomainError("INVALID_INPUT", "masterUserId er påkrevd.");
    }
    const run = await this.findForDay(hall, dateStr);
    if (!run) {
      throw new DomainError(
        "GAME_PLAN_RUN_NOT_FOUND",
        "Ingen run for (hall, businessDate). Kall getOrCreateForToday først.",
      );
    }
    if (run.status !== "idle") {
      throw new DomainError(
        "GAME_PLAN_RUN_INVALID_TRANSITION",
        `Kan ikke starte run med status=${run.status} (kun 'idle' tillatt).`,
      );
    }
    // BUG-D1 fix (2026-05-15): `start()` skal IKKE overstyre current_position.
    // `getOrCreateForToday`-INSERT er eneste sannhet for posisjon ved start —
    // den beregner riktig `nextPosition` basert på `previousPosition` (auto-
    // advance BUG E, PR #1422). Tidligere hardkodet vi `current_position = 1`
    // her, som overskrev den riktige verdien og førte til at master spilte
    // Bingo (pos=1) gjentatte ganger i stedet for å advance til 1000-spill,
    // 5×500, osv. Se `docs/engineering/PITFALLS_LOG.md` §3.15 og
    // `docs/research/NEXT_GAME_DISPLAY_AGENT_D_SCHEDULEDGAME_2026-05-14.md` §5.1.
    await this.pool.query(
      `UPDATE ${this.table()}
       SET status = 'running',
           started_at = COALESCE(started_at, now()),
           master_user_id = $2,
           updated_at = now()
       WHERE id = $1`,
      [run.id, masterUserId.trim()],
    );
    void this.audit({
      actorId: masterUserId.trim(),
      actorType: "USER",
      action: "game_plan_run.start",
      resourceId: run.id,
      details: { planId: run.planId, hallId: hall, businessDate: dateStr },
    });
    return this.requireById(run.id);
  }

  async pause(
    hallId: string,
    businessDate: Date | string,
    masterUserId: string,
  ): Promise<GamePlanRun> {
    return this.changeStatus(hallId, businessDate, masterUserId, "paused", [
      "running",
    ]);
  }

  async resume(
    hallId: string,
    businessDate: Date | string,
    masterUserId: string,
  ): Promise<GamePlanRun> {
    return this.changeStatus(hallId, businessDate, masterUserId, "running", [
      "paused",
    ]);
  }

  async finish(
    hallId: string,
    businessDate: Date | string,
    masterUserId: string,
  ): Promise<GamePlanRun> {
    return this.changeStatus(hallId, businessDate, masterUserId, "finished", [
      "idle",
      "running",
      "paused",
    ]);
  }

  /**
   * Forsøk å flytte til neste posisjon. Hvis catalog-entry på ny posisjon
   * krever jackpot-setup og override mangler i `jackpot_overrides_json`,
   * blir run IKKE oppdatert — service-en returnerer bare
   * `jackpotSetupRequired=true` så caller (master-UI) kan vise popup.
   *
   * Hvis vi går forbi siste posisjon i sekvensen → status=finished.
   */
  async advanceToNext(
    hallId: string,
    businessDate: Date | string,
    masterUserId: string,
  ): Promise<AdvanceToNextResult> {
    const hall = assertHallId(hallId);
    const dateStr = assertBusinessDate(businessDate);
    if (typeof masterUserId !== "string" || !masterUserId.trim()) {
      throw new DomainError("INVALID_INPUT", "masterUserId er påkrevd.");
    }
    const run = await this.findForDay(hall, dateStr);
    if (!run) {
      throw new DomainError(
        "GAME_PLAN_RUN_NOT_FOUND",
        "Ingen run for (hall, businessDate).",
      );
    }
    if (run.status !== "running" && run.status !== "paused") {
      throw new DomainError(
        "GAME_PLAN_RUN_INVALID_TRANSITION",
        `Kan ikke advance fra status=${run.status} (krever 'running' eller 'paused').`,
      );
    }

    const plan = await this.planService.getById(run.planId);
    if (!plan) {
      throw new DomainError(
        "GAME_PLAN_NOT_FOUND",
        "Plan finnes ikke (sletet?).",
      );
    }
    const items = plan.items;
    const newPosition = run.currentPosition + 1;
    if (newPosition > items.length) {
      // Siste posisjon nådd — finish.
      await this.pool.query(
        `UPDATE ${this.table()}
         SET status = 'finished',
             finished_at = now(),
             updated_at = now()
         WHERE id = $1`,
        [run.id],
      );
      void this.audit({
        actorId: masterUserId.trim(),
        actorType: "USER",
        action: "game_plan_run.finish",
        resourceId: run.id,
        details: {
          reason: "advance_past_end",
          previousPosition: run.currentPosition,
        },
      });
      // Pilot Q3 2026 (2026-05-15): broadcast så spiller-shell viser
      // "Ferdig for dagen" umiddelbart. Speilet samme pattern som
      // changeStatus(target='finished').
      this.fireLobbyBroadcastForFinish(hall);
      const finished = await this.requireById(run.id);
      return { run: finished, nextGame: null, jackpotSetupRequired: false };
    }

    const nextItem = items.find((i) => i.position === newPosition);
    if (!nextItem) {
      throw new DomainError(
        "GAME_PLAN_RUN_CORRUPT",
        `Plan-sekvens har ingen item på posisjon ${newPosition}.`,
      );
    }
    const nextGame = nextItem.catalogEntry;

    // Sjekk om jackpot-setup mangler.
    const overrideKey = String(newPosition);
    const hasOverride =
      Object.prototype.hasOwnProperty.call(run.jackpotOverrides, overrideKey);
    if (nextGame.requiresJackpotSetup && !hasOverride) {
      // IKKE oppdater run — bare returner flagget. Master-UI viser popup,
      // setJackpotOverride lagrer data, deretter kalles advanceToNext igjen.
      return {
        run,
        nextGame,
        jackpotSetupRequired: true,
      };
    }

    await this.pool.query(
      `UPDATE ${this.table()}
       SET current_position = $2,
           updated_at = now()
       WHERE id = $1`,
      [run.id, newPosition],
    );
    void this.audit({
      actorId: masterUserId.trim(),
      actorType: "USER",
      action: "game_plan_run.advance",
      resourceId: run.id,
      details: {
        fromPosition: run.currentPosition,
        toPosition: newPosition,
        catalogId: nextGame.id,
        catalogSlug: nextGame.slug,
      },
    });
    const advanced = await this.requireById(run.id);
    return { run: advanced, nextGame, jackpotSetupRequired: false };
  }

  /**
   * Lagre jackpot-popup-data fra master. Position må peke til en jackpot-
   * posisjon i den løpende planen (catalog-entry må ha
   * requiresJackpotSetup=true). Prizes-keys må matche catalog-entry sine
   * ticketColors.
   */
  async setJackpotOverride(
    hallId: string,
    businessDate: Date | string,
    position: number,
    override: { draw: number; prizesCents: Record<string, number> },
    masterUserId: string,
  ): Promise<GamePlanRun> {
    const hall = assertHallId(hallId);
    const dateStr = assertBusinessDate(businessDate);
    if (
      !Number.isFinite(position) ||
      !Number.isInteger(position) ||
      position < 1
    ) {
      throw new DomainError("INVALID_INPUT", "position må være positivt heltall.");
    }
    if (typeof masterUserId !== "string" || !masterUserId.trim()) {
      throw new DomainError("INVALID_INPUT", "masterUserId er påkrevd.");
    }
    const run = await this.findForDay(hall, dateStr);
    if (!run) {
      throw new DomainError(
        "GAME_PLAN_RUN_NOT_FOUND",
        "Ingen run for (hall, businessDate).",
      );
    }
    if (run.status === "finished") {
      throw new DomainError(
        "GAME_PLAN_RUN_INVALID_TRANSITION",
        "Kan ikke sette jackpot-override på en ferdig run.",
      );
    }
    const plan = await this.planService.getById(run.planId);
    if (!plan) {
      throw new DomainError("GAME_PLAN_NOT_FOUND", "Plan finnes ikke.");
    }
    const item = plan.items.find((i) => i.position === position);
    if (!item) {
      throw new DomainError(
        "INVALID_INPUT",
        `Plan har ingen item på posisjon ${position}.`,
      );
    }
    if (!item.catalogEntry.requiresJackpotSetup) {
      throw new DomainError(
        "INVALID_INPUT",
        `Spillet på posisjon ${position} krever ikke jackpot-setup.`,
      );
    }
    const allowedColors = new Set<TicketColor>(item.catalogEntry.ticketColors);
    const validated = assertJackpotOverride(override, allowedColors);

    // Atomisk merge — jsonb_set ville krevd at vi serialiserte hver verdi
    // separat. Vi leser, merger, skriver tilbake. Her er det safe fordi
    // master er én bruker per hall og vi ikke har samtidighet på samme
    // (hall, position).
    const merged = { ...run.jackpotOverrides, [String(position)]: validated };
    await this.pool.query(
      `UPDATE ${this.table()}
       SET jackpot_overrides_json = $2::jsonb,
           updated_at = now()
       WHERE id = $1`,
      [run.id, JSON.stringify(merged)],
    );
    void this.audit({
      actorId: masterUserId.trim(),
      actorType: "USER",
      action: "game_plan_run.jackpot_set",
      resourceId: run.id,
      details: {
        position,
        catalogId: item.catalogEntry.id,
        catalogSlug: item.catalogEntry.slug,
        draw: validated.draw,
        prizeColors: Object.keys(validated.prizesCents),
      },
    });
    return this.requireById(run.id);
  }

  /**
   * Pilot Q3 2026 (PR #1116, 2026-05-09): rollback en plan-run fra
   * `running` tilbake til `idle` med restore av `current_position`. Brukt
   * av `MasterActionService` etter at engine-bridge-spawn feilet 3 ganger
   * — vi sletter ikke rad-en, men setter status tilbake slik at master
   * kan trygt re-prøve `start`/`advance` uten å havne i
   * `GAME_PLAN_RUN_INVALID_TRANSITION`.
   *
   * Atomisk WHERE-klausul (status/position match) gjør operasjonen idempotent
   * og no-op hvis run allerede er i forventet rollback-tilstand. Returnerer
   * `null` hvis ingen rad ble oppdatert (run ble endret av annen aktør i
   * mellomtiden) — caller bestemmer om dette er feil eller akseptabelt.
   *
   * Audit: `game_plan_run.rollback` med `reason`, `fromPosition`,
   * `toPosition`, og `correlationId` for full sporbarhet i Lotteritilsynet-
   * audit. Reason er påkrevd så vi alltid vet HVORFOR rollback skjedde.
   */
  async rollbackToIdle(input: {
    runId: string;
    expectedStatus: GamePlanRunStatus;
    expectedPosition: number;
    targetPosition: number;
    reason: string;
    masterUserId: string;
    correlationId?: string;
  }): Promise<GamePlanRun | null> {
    const runId = (input.runId ?? "").trim();
    if (!runId) {
      throw new DomainError("INVALID_INPUT", "runId er påkrevd.");
    }
    const reason = (input.reason ?? "").trim();
    if (!reason) {
      throw new DomainError(
        "INVALID_INPUT",
        "reason er påkrevd ved rollback (audit-trail).",
      );
    }
    const masterUserId = (input.masterUserId ?? "").trim();
    if (!masterUserId) {
      throw new DomainError("INVALID_INPUT", "masterUserId er påkrevd.");
    }
    if (
      !Number.isFinite(input.expectedPosition) ||
      !Number.isInteger(input.expectedPosition) ||
      input.expectedPosition < 1
    ) {
      throw new DomainError(
        "INVALID_INPUT",
        "expectedPosition må være positivt heltall.",
      );
    }
    const targetPos = Math.max(1, Math.trunc(input.targetPosition));
    if (input.expectedStatus !== "running") {
      throw new DomainError(
        "INVALID_INPUT",
        `rollbackToIdle støtter kun expectedStatus='running' (fikk '${input.expectedStatus}').`,
      );
    }

    const result = await this.pool.query(
      `UPDATE ${this.table()}
       SET status = 'idle',
           current_position = $4,
           started_at = NULL,
           updated_at = now()
       WHERE id = $1
         AND status = $2
         AND current_position = $3`,
      [runId, input.expectedStatus, input.expectedPosition, targetPos],
    );

    if (result.rowCount === 0) {
      logger.warn(
        {
          runId,
          expectedStatus: input.expectedStatus,
          expectedPosition: input.expectedPosition,
          targetPosition: targetPos,
          reason,
          correlationId: input.correlationId ?? null,
        },
        "[fase-1] rollbackToIdle no-op — state changed under us",
      );
      return null;
    }

    void this.audit({
      actorId: masterUserId,
      actorType: "USER",
      action: "game_plan_run.rollback",
      resourceId: runId,
      details: {
        fromStatus: input.expectedStatus,
        toStatus: "idle",
        fromPosition: input.expectedPosition,
        toPosition: targetPos,
        reason,
        correlationId: input.correlationId ?? null,
      },
    });

    return this.requireById(runId);
  }

  /**
   * Pilot Q3 2026 (PR #1116, 2026-05-09): rollback `current_position`
   * til en tidligere verdi UTEN å endre status. Brukt av `MasterActionService`
   * etter at engine-bridge-spawn for en ADVANCE-action feilet — vi ruller
   * position tilbake til forrige verdi så master kan trygt re-prøve
   * `/advance` uten at planen tror den allerede er flyttet.
   */
  async rollbackPosition(input: {
    runId: string;
    expectedStatus: GamePlanRunStatus;
    expectedPosition: number;
    targetPosition: number;
    reason: string;
    masterUserId: string;
    correlationId?: string;
  }): Promise<GamePlanRun | null> {
    const runId = (input.runId ?? "").trim();
    if (!runId) {
      throw new DomainError("INVALID_INPUT", "runId er påkrevd.");
    }
    const reason = (input.reason ?? "").trim();
    if (!reason) {
      throw new DomainError(
        "INVALID_INPUT",
        "reason er påkrevd ved rollback (audit-trail).",
      );
    }
    const masterUserId = (input.masterUserId ?? "").trim();
    if (!masterUserId) {
      throw new DomainError("INVALID_INPUT", "masterUserId er påkrevd.");
    }
    if (
      !Number.isFinite(input.expectedPosition) ||
      !Number.isInteger(input.expectedPosition) ||
      input.expectedPosition < 1
    ) {
      throw new DomainError(
        "INVALID_INPUT",
        "expectedPosition må være positivt heltall.",
      );
    }
    if (
      !Number.isFinite(input.targetPosition) ||
      !Number.isInteger(input.targetPosition) ||
      input.targetPosition < 1
    ) {
      throw new DomainError(
        "INVALID_INPUT",
        "targetPosition må være positivt heltall.",
      );
    }
    if (input.targetPosition >= input.expectedPosition) {
      throw new DomainError(
        "INVALID_INPUT",
        `targetPosition (${input.targetPosition}) må være < expectedPosition (${input.expectedPosition}).`,
      );
    }
    if (input.expectedStatus !== "running" && input.expectedStatus !== "paused") {
      throw new DomainError(
        "INVALID_INPUT",
        `rollbackPosition støtter kun 'running' eller 'paused' (fikk '${input.expectedStatus}').`,
      );
    }

    const result = await this.pool.query(
      `UPDATE ${this.table()}
       SET current_position = $4,
           updated_at = now()
       WHERE id = $1
         AND status = $2
         AND current_position = $3`,
      [
        runId,
        input.expectedStatus,
        input.expectedPosition,
        input.targetPosition,
      ],
    );

    if (result.rowCount === 0) {
      logger.warn(
        {
          runId,
          expectedStatus: input.expectedStatus,
          expectedPosition: input.expectedPosition,
          targetPosition: input.targetPosition,
          reason,
          correlationId: input.correlationId ?? null,
        },
        "[fase-1] rollbackPosition no-op — state changed under us",
      );
      return null;
    }

    void this.audit({
      actorId: masterUserId,
      actorType: "USER",
      action: "game_plan_run.position_rollback",
      resourceId: runId,
      details: {
        status: input.expectedStatus,
        fromPosition: input.expectedPosition,
        toPosition: input.targetPosition,
        reason,
        correlationId: input.correlationId ?? null,
      },
    });

    return this.requireById(runId);
  }

  // ── interne hjelpere ──────────────────────────────────────────────────

  private async changeStatus(
    hallId: string,
    businessDate: Date | string,
    masterUserId: string,
    target: GamePlanRunStatus,
    allowedFrom: GamePlanRunStatus[],
  ): Promise<GamePlanRun> {
    const hall = assertHallId(hallId);
    const dateStr = assertBusinessDate(businessDate);
    if (typeof masterUserId !== "string" || !masterUserId.trim()) {
      throw new DomainError("INVALID_INPUT", "masterUserId er påkrevd.");
    }
    const run = await this.findForDay(hall, dateStr);
    if (!run) {
      throw new DomainError(
        "GAME_PLAN_RUN_NOT_FOUND",
        "Ingen run for (hall, businessDate).",
      );
    }
    if (!allowedFrom.includes(run.status)) {
      throw new DomainError(
        "GAME_PLAN_RUN_INVALID_TRANSITION",
        `Kan ikke gå fra status=${run.status} til ${target}.`,
      );
    }
    const finishedFragment =
      target === "finished"
        ? ", finished_at = COALESCE(finished_at, now())"
        : "";
    await this.pool.query(
      `UPDATE ${this.table()}
       SET status = $2,
           updated_at = now()${finishedFragment}
       WHERE id = $1`,
      [run.id, target],
    );
    void this.audit({
      actorId: masterUserId.trim(),
      actorType: "USER",
      action: `game_plan_run.${target}`,
      resourceId: run.id,
      details: { fromStatus: run.status, toStatus: target },
    });
    // Pilot Q3 2026 (2026-05-15): broadcast spiller-shell-state etter
    // finish så "Ferdig for dagen" vises umiddelbart. Andre overganger
    // (idle/running/paused) trenger ikke push — klient mottar dem via
    // master-action-pathen (MasterActionService.fireLobbyBroadcast).
    if (target === "finished") {
      this.fireLobbyBroadcastForFinish(hall);
    }
    return this.requireById(run.id);
  }

  private async requireById(id: string): Promise<GamePlanRun> {
    const { rows } = await this.pool.query<GamePlanRunRow>(
      `SELECT id, plan_id, hall_id, business_date, current_position, status,
              jackpot_overrides_json, started_at, finished_at, master_user_id,
              created_at, updated_at
       FROM ${this.table()}
       WHERE id = $1`,
      [id],
    );
    if (!rows[0]) {
      throw new DomainError(
        "GAME_PLAN_RUN_NOT_FOUND",
        `Run ${id} finnes ikke.`,
      );
    }
    return mapRow(rows[0]);
  }

  private weekdayFromDateStr(dateStr: string): string {
    // dateStr = "YYYY-MM-DD" — bruk Date.parse i UTC og hent dag-of-week
    // basert på lokal-tid. Caller har allerede normalisert til Oslo-tz
    // (samme antagelse som CloseDayService).
    const d = new Date(`${dateStr}T00:00:00Z`);
    const idx = d.getUTCDay(); // 0 = Sunday, 1 = Monday, ...
    return ["sun", "mon", "tue", "wed", "thu", "fri", "sat"][idx];
  }

  // ── audit-helper ──────────────────────────────────────────────────────

  private async audit(input: {
    actorId: string;
    actorType: "USER" | "SYSTEM" | "ADMIN";
    action: string;
    resourceId: string | null;
    details: Record<string, unknown>;
  }): Promise<void> {
    if (!this.auditLogService) return;
    try {
      await this.auditLogService.record({
        actorId: input.actorId,
        actorType: input.actorType,
        action: input.action,
        resource: "game_plan_run",
        resourceId: input.resourceId,
        details: input.details,
      });
    } catch (err) {
      logger.warn(
        { err, action: input.action },
        "[fase-1] audit-log feilet — fortsetter",
      );
    }
  }
}
