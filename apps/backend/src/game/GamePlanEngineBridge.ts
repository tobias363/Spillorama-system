/**
 * Fase 4 (2026-05-07): GamePlanEngineBridge — bro mellom katalog-modellen
 * (Fase 1) og legacy draw-engine (Game1MasterControlService.startGame).
 *
 * Bakgrunn (Fase 4-spec §1):
 * Game1MasterControlService.startGame leser en eksisterende rad i
 * `app_game1_scheduled_games` og kjører engine basert på:
 *   - participating_halls_json
 *   - master_hall_id, group_hall_id
 *   - sub_game_name, notification_start_seconds
 *   - ticket_config_json, jackpot_config_json, game_config_json
 *
 * For at engine skal kunne kjøre fra ny katalog-modell uten omfattende
 * refaktor, bruker bridgen en SHIM-tilnærming:
 *   1) `createScheduledGameForPlanRunPosition(runId, position)` opprettes
 *      en `app_game1_scheduled_games`-rad med:
 *      - catalog_entry_id   = catalog-rad fra plan-item
 *      - plan_run_id        = run.id
 *      - plan_position      = position
 *      - sub_game_name      = catalog.displayName
 *      - ticket_config_json = derivert fra catalog (farger, priser, premier)
 *      - jackpot_config_json = jackpot-override (hvis catalog krever setup)
 *      - master_hall_id     = run.hallId
 *      - group_hall_id      = run.hallId (single-hall planer for nå)
 *      - participating_halls_json = [run.hallId]
 *      - status             = 'ready_to_start'
 *   2) Returnerer scheduled_game.id som passes til
 *      `Game1MasterControlService.startGame({ gameId, actor })`.
 *   3) Engine kjører uendret — den vet ikke at raden er bridge-spawnet.
 *
 * Out-of-scope:
 *   - Multi-hall planer (Fase 4 fokuserer på single-hall; group-of-halls
 *     krever app_groups-tabellen som ikke finnes ennå).
 *   - Bonus-spill-integrasjon i engine (catalog.bonus_game_slug propageres
 *     til ticket_config_json så MiniGameRouter kan plukke det opp, men
 *     selve trigger-logikken er fortsatt i engine).
 *   - Mock-vennlig pool: vi tar pool i konstruktør slik at tester kan
 *     injisere en stub.
 *
 * Wire-protokoll:
 *   - Caller (agentGamePlan.ts /start) henter run + plan via plan-services
 *     og delegerer til bridgen for å produsere en gameId.
 *   - Bridgen er IDEMPOTENT på (plan_run_id, plan_position) — re-kall med
 *     samme nøkkel returnerer eksisterende rad. Dette beskytter mot dobbel-
 *     spawn ved network-retries.
 */

import { randomUUID } from "node:crypto";
import type { Pool } from "pg";

import { DomainError } from "../errors/DomainError.js";
import { logger as rootLogger } from "../util/logger.js";
import type { GameCatalogService } from "./GameCatalogService.js";
import type { GamePlanService } from "./GamePlanService.js";
import type { GamePlanRunService } from "./GamePlanRunService.js";
import type {
  GameCatalogEntry,
  TicketColor,
} from "./gameCatalog.types.js";
import type { JackpotOverride } from "./gamePlan.types.js";

const log = rootLogger.child({ module: "game-plan-engine-bridge" });

// Default notification-window i sekunder. Engine bruker dette for
// purchase_open → ready_to_start-transisjonen. Catalog-modellen har ikke
// et eksplisitt felt for dette ennå (rules-json kunne hatt det), så vi
// bruker 5 minutter som baseline (samme som legacy "5m" parser).
const DEFAULT_NOTIFICATION_SECONDS = 300;

// Lengde på purchase-vinduet. Vi sikter på 10 minutter for catalog-spill —
// noen rader trenger lengre (jackpot-spill kan ha 30 min) men det er ikke
// dokumentert i catalog-skjemaet ennå. Default er en kvalifisert gjetning.
const DEFAULT_PURCHASE_WINDOW_SECONDS = 600;

function assertSchemaName(schema: string): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(schema)) {
    throw new DomainError("INVALID_CONFIG", "Ugyldig schema-navn.");
  }
  return schema;
}

/**
 * Bygg ticket_config_json fra catalog-entry. Engine + Game1PayoutService
 * leser denne for å vite ticket-typer + premier per pattern.
 *
 * Mapping (catalog → legacy ticket_config_json):
 *   - ticketTypes:   ticketColors-listen (Engine forventer "yellow"/"white"/
 *                    "purple" på engelsk, så vi mapper "gul"→"yellow" osv.)
 *   - ticketPrice:   ticketPricesCents (per farge)
 *   - ticketPrize:   prizesCents.bingo (per farge — Fullt Hus)
 *   - rowPrizes:     {row1, row2, row3, row4} = prizesCents.rad1-rad4
 *   - bonusGame:     {slug, enabled} fra catalog
 *   - catalogId:     catalog-id for revers-binding (engine kan slå opp
 *                    catalog-konfig hvis nødvendig)
 *
 * Engine sin nåværende kode plukker ut ticketTypesData["yellow"] osv. via
 * legacy-keys. Catalog bruker norsk farge-vokabular, så bridgen oversetter
 * her — ikke i engine.
 */
const NORWEGIAN_TO_ENGLISH_COLOR: Record<TicketColor, string> = {
  gul: "yellow",
  hvit: "white",
  lilla: "purple",
};

export function buildTicketConfigFromCatalog(
  catalog: GameCatalogEntry,
): Record<string, unknown> {
  const ticketTypes: Record<string, { price: number; prize: number }> = {};
  for (const color of catalog.ticketColors) {
    const englishKey = NORWEGIAN_TO_ENGLISH_COLOR[color] ?? color;
    const price = catalog.ticketPricesCents[color] ?? 0;
    const prize = catalog.prizesCents.bingo[color] ?? 0;
    ticketTypes[englishKey] = { price, prize };
  }

  const config: Record<string, unknown> = {
    catalogId: catalog.id,
    catalogSlug: catalog.slug,
    ticketTypes,
    rowPrizes: {
      row1: catalog.prizesCents.rad1,
      row2: catalog.prizesCents.rad2,
      row3: catalog.prizesCents.rad3,
      row4: catalog.prizesCents.rad4,
    },
    // Tobias 2026-05-07: rules-objektet beholdes som "extra" så engine kan
    // lese spill-spesifikk config (mini-game-rotation, lucky number osv.)
    // hvis admin har lagt til detaljer.
    rules: catalog.rules,
  };

  if (catalog.bonusGameEnabled && catalog.bonusGameSlug) {
    config.bonusGame = {
      slug: catalog.bonusGameSlug,
      enabled: true,
    };
  }

  return config;
}

/**
 * Bygg jackpot_config_json fra override. Engine forventer:
 *   { jackpotPrize: { yellow, white, purple }, jackpotDraw }
 * Override-keyen er per farge på norsk; vi oversetter til engelsk.
 *
 * Returnerer tom objekt hvis override mangler — engine tolererer da at
 * spillet ikke har jackpot.
 */
export function buildJackpotConfigFromOverride(
  override: JackpotOverride | null,
): Record<string, unknown> {
  if (!override) return {};
  const jackpotPrize: Record<string, number> = {};
  for (const [color, amount] of Object.entries(override.prizesCents)) {
    if (typeof amount !== "number") continue;
    const englishKey =
      NORWEGIAN_TO_ENGLISH_COLOR[color as TicketColor] ?? color;
    jackpotPrize[englishKey] = amount;
  }
  return {
    jackpotPrize,
    jackpotDraw: override.draw,
  };
}

export interface GamePlanEngineBridgeOptions {
  pool: Pool;
  schema?: string;
  catalogService: GameCatalogService;
  planService: GamePlanService;
  planRunService: GamePlanRunService;
}

export interface CreateScheduledGameResult {
  scheduledGameId: string;
  catalogEntry: GameCatalogEntry;
  /**
   * True hvis vi gjenbrukte en eksisterende rad (idempotent retry).
   * False hvis vi nettopp opprettet raden.
   */
  reused: boolean;
}

export class GamePlanEngineBridge {
  private readonly pool: Pool;
  private readonly schema: string;
  private readonly catalogService: GameCatalogService;
  private readonly planService: GamePlanService;
  private readonly planRunService: GamePlanRunService;

  constructor(options: GamePlanEngineBridgeOptions) {
    this.pool = options.pool;
    this.schema = assertSchemaName(options.schema ?? "public");
    this.catalogService = options.catalogService;
    this.planService = options.planService;
    this.planRunService = options.planRunService;
  }

  /** @internal — test-hook. */
  static forTesting(
    opts: GamePlanEngineBridgeOptions,
  ): GamePlanEngineBridge {
    const svc = Object.create(
      GamePlanEngineBridge.prototype,
    ) as GamePlanEngineBridge;
    (svc as unknown as { pool: Pool }).pool = opts.pool;
    (svc as unknown as { schema: string }).schema = assertSchemaName(
      opts.schema ?? "public",
    );
    (svc as unknown as {
      catalogService: GameCatalogService;
    }).catalogService = opts.catalogService;
    (svc as unknown as {
      planService: GamePlanService;
    }).planService = opts.planService;
    (svc as unknown as {
      planRunService: GamePlanRunService;
    }).planRunService = opts.planRunService;
    return svc;
  }

  private scheduledGamesTable(): string {
    return `"${this.schema}"."app_game1_scheduled_games"`;
  }

  /**
   * Slå opp jackpot-override for en gitt posisjon i en aktiv plan-run.
   * Returnerer null hvis catalog-spillet ikke krever override eller hvis
   * override ikke er satt ennå.
   */
  async getJackpotConfigForPosition(
    runId: string,
    position: number,
  ): Promise<JackpotOverride | null> {
    if (!runId.trim()) {
      throw new DomainError("INVALID_INPUT", "runId er påkrevd.");
    }
    if (
      !Number.isFinite(position) ||
      !Number.isInteger(position) ||
      position < 1
    ) {
      throw new DomainError(
        "INVALID_INPUT",
        "position må være positivt heltall.",
      );
    }
    // Hent run direkte. Vi går rundt run-service her fordi vi trenger raw
    // jackpotOverrides per position-key (ikke wire-format).
    const { rows } = await this.pool.query<{
      jackpot_overrides_json: unknown;
    }>(
      `SELECT jackpot_overrides_json
       FROM "${this.schema}"."app_game_plan_run"
       WHERE id = $1`,
      [runId.trim()],
    );
    if (!rows[0]) {
      throw new DomainError(
        "GAME_PLAN_RUN_NOT_FOUND",
        `Run ${runId} finnes ikke.`,
      );
    }
    const overrides = rows[0].jackpot_overrides_json;
    if (!overrides || typeof overrides !== "object" || Array.isArray(overrides)) {
      return null;
    }
    const key = String(position);
    const raw = (overrides as Record<string, unknown>)[key];
    if (!raw || typeof raw !== "object") return null;
    const obj = raw as Record<string, unknown>;
    const drawN = Number(obj.draw);
    if (!Number.isFinite(drawN)) return null;
    let prizesRaw: unknown = obj.prizesCents;
    if (prizesRaw === undefined) prizesRaw = obj.prizes_cents;
    if (!prizesRaw || typeof prizesRaw !== "object") return null;
    const prizes: Partial<Record<TicketColor, number>> = {};
    for (const [k, v] of Object.entries(prizesRaw as Record<string, unknown>)) {
      const n = Number(v);
      if (Number.isFinite(n) && Number.isInteger(n) && n >= 0) {
        prizes[k as TicketColor] = n;
      }
    }
    return { draw: drawN, prizesCents: prizes };
  }

  /**
   * Opprett en `app_game1_scheduled_games`-rad fra en plan-run-posisjon.
   * Idempotent på (plan_run_id, plan_position).
   *
   * Returnerer scheduledGameId som kan sendes til
   * `Game1MasterControlService.startGame({ gameId })`.
   *
   * Pre-conditions:
   *   - Run må finnes for runId.
   *   - Plan må ha et item på position.
   *   - Hvis catalog-spillet krever jackpot-setup, må override være satt
   *     i run.jackpot_overrides_json[String(position)] — ellers kastes
   *     `JACKPOT_SETUP_REQUIRED`.
   */
  async createScheduledGameForPlanRunPosition(
    runId: string,
    position: number,
  ): Promise<CreateScheduledGameResult> {
    if (!runId.trim()) {
      throw new DomainError("INVALID_INPUT", "runId er påkrevd.");
    }
    if (
      !Number.isFinite(position) ||
      !Number.isInteger(position) ||
      position < 1
    ) {
      throw new DomainError(
        "INVALID_INPUT",
        "position må være positivt heltall.",
      );
    }

    // Hent run-rad direkte (uten å bruke run-service-mapping) for å få
    // alle relevante felter på én gang.
    const { rows: runRows } = await this.pool.query<{
      id: string;
      plan_id: string;
      hall_id: string;
      business_date: unknown;
      jackpot_overrides_json: unknown;
    }>(
      `SELECT id, plan_id, hall_id, business_date, jackpot_overrides_json
       FROM "${this.schema}"."app_game_plan_run"
       WHERE id = $1`,
      [runId.trim()],
    );
    const run = runRows[0];
    if (!run) {
      throw new DomainError(
        "GAME_PLAN_RUN_NOT_FOUND",
        `Run ${runId} finnes ikke.`,
      );
    }

    // Idempotens-sjekk: finnes allerede en rad for (run, position)?
    const { rows: existing } = await this.pool.query<{
      id: string;
      catalog_entry_id: string | null;
    }>(
      `SELECT id, catalog_entry_id
       FROM ${this.scheduledGamesTable()}
       WHERE plan_run_id = $1 AND plan_position = $2
       LIMIT 1`,
      [run.id, position],
    );
    if (existing[0]) {
      // Re-fetch catalog så vi kan returnere full entry. Det kan ha endret
      // seg siden raden ble opprettet (admin har redigert), men vi binder
      // engine til den ORIGINALE catalog_entry_id for sporbarhet.
      const catalogId = existing[0].catalog_entry_id;
      if (!catalogId) {
        throw new DomainError(
          "GAME_PLAN_RUN_CORRUPT",
          `Eksisterende scheduled-game ${existing[0].id} mangler catalog_entry_id.`,
        );
      }
      const catalog = await this.catalogService.getById(catalogId);
      if (!catalog) {
        throw new DomainError(
          "GAME_CATALOG_NOT_FOUND",
          `Catalog-entry ${catalogId} finnes ikke (slettet?).`,
        );
      }
      log.info(
        { runId: run.id, position, scheduledGameId: existing[0].id },
        "[fase-4] gjenbruker eksisterende scheduled-game-rad (idempotent retry)",
      );
      return {
        scheduledGameId: existing[0].id,
        catalogEntry: catalog,
        reused: true,
      };
    }

    // Hent plan + items
    const plan = await this.planService.getById(run.plan_id);
    if (!plan) {
      throw new DomainError(
        "GAME_PLAN_NOT_FOUND",
        `Plan ${run.plan_id} finnes ikke (slettet etter run-create).`,
      );
    }
    const item = plan.items.find((i) => i.position === position);
    if (!item) {
      throw new DomainError(
        "INVALID_INPUT",
        `Plan ${plan.id} har ingen item på posisjon ${position}.`,
      );
    }
    const catalog = item.catalogEntry;

    // Sjekk jackpot-setup
    let jackpotOverride: JackpotOverride | null = null;
    if (catalog.requiresJackpotSetup) {
      const overridesRaw = run.jackpot_overrides_json;
      if (
        overridesRaw &&
        typeof overridesRaw === "object" &&
        !Array.isArray(overridesRaw)
      ) {
        const key = String(position);
        const raw = (overridesRaw as Record<string, unknown>)[key];
        if (raw && typeof raw === "object") {
          const obj = raw as Record<string, unknown>;
          const drawN = Number(obj.draw);
          let prizesRaw: unknown = obj.prizesCents;
          if (prizesRaw === undefined) prizesRaw = obj.prizes_cents;
          if (
            Number.isFinite(drawN) &&
            prizesRaw &&
            typeof prizesRaw === "object" &&
            !Array.isArray(prizesRaw)
          ) {
            const prizes: Partial<Record<TicketColor, number>> = {};
            for (const [k, v] of Object.entries(
              prizesRaw as Record<string, unknown>,
            )) {
              const n = Number(v);
              if (Number.isFinite(n) && Number.isInteger(n) && n >= 0) {
                prizes[k as TicketColor] = n;
              }
            }
            jackpotOverride = { draw: drawN, prizesCents: prizes };
          }
        }
      }
      if (!jackpotOverride) {
        throw new DomainError(
          "JACKPOT_SETUP_REQUIRED",
          `Catalog ${catalog.slug} krever jackpot-setup, men override mangler for posisjon ${position}.`,
          { position, catalogId: catalog.id, catalogSlug: catalog.slug },
        );
      }
    }

    // Bygg konfig-objekter
    const ticketConfig = buildTicketConfigFromCatalog(catalog);
    const jackpotConfig = buildJackpotConfigFromOverride(jackpotOverride);

    // Bygg participating_halls = bare run.hall_id (single-hall i Fase 4).
    // Multi-hall via groupOfHalls støttes når app_groups-tabellen lander.
    const participatingHalls = [run.hall_id];

    // Hent hall-group som hallen tilhører (engine forventer group_hall_id).
    // Hvis hallen ikke er i en gruppe, oppretter vi ikke en — vi velger
    // første aktive gruppe-medlemskap, eller hallen selv som fallback.
    const groupHallId = await this.resolveGroupHallId(run.hall_id);

    // scheduled_start_time = NOW (engine starter umiddelbart). End_time =
    // now + DEFAULT_PURCHASE_WINDOW_SECONDS. Disse styrer ikke draw-rytmen,
    // bare scheduler-tick-vinduer.
    const now = new Date();
    const startTs = now.toISOString();
    const endTs = new Date(
      now.getTime() + DEFAULT_PURCHASE_WINDOW_SECONDS * 1000,
    ).toISOString();
    const businessDateKey = this.dateRowToKey(run.business_date);

    const newId = randomUUID();
    try {
      await this.pool.query(
        `INSERT INTO ${this.scheduledGamesTable()}
           (id,
            sub_game_index,
            sub_game_name,
            custom_game_name,
            scheduled_day,
            scheduled_start_time,
            scheduled_end_time,
            notification_start_seconds,
            ticket_config_json,
            jackpot_config_json,
            game_mode,
            master_hall_id,
            group_hall_id,
            participating_halls_json,
            status,
            game_config_json,
            catalog_entry_id,
            plan_run_id,
            plan_position)
         VALUES ($1, $2, $3, $4, $5::date, $6::timestamptz, $7::timestamptz,
                 $8, $9::jsonb, $10::jsonb, $11, $12, $13, $14::jsonb,
                 'ready_to_start', NULL, $15, $16, $17)`,
        [
          newId,
          // sub_game_index — vi bruker plan_position-1 (0-basert)
          position - 1,
          // sub_game_name
          catalog.displayName,
          // custom_game_name
          null,
          businessDateKey,
          startTs,
          endTs,
          DEFAULT_NOTIFICATION_SECONDS,
          JSON.stringify(ticketConfig),
          JSON.stringify(jackpotConfig),
          // game_mode — Manual fordi master driver framgang i katalog-modellen
          "Manual",
          run.hall_id,
          groupHallId,
          JSON.stringify(participatingHalls),
          catalog.id,
          run.id,
          position,
        ],
      );
    } catch (err) {
      const code = (err as { code?: string } | null)?.code ?? "";
      if (code === "23503") {
        // FK-violation — sannsynligvis hall eller hall-group mangler
        throw new DomainError(
          "GAME_PLAN_RUN_CORRUPT",
          `Kan ikke spawne scheduled-game: hall (${run.hall_id}) eller hall-group (${groupHallId}) ikke funnet.`,
        );
      }
      throw err;
    }

    log.info(
      {
        runId: run.id,
        position,
        scheduledGameId: newId,
        catalogId: catalog.id,
        catalogSlug: catalog.slug,
        hallId: run.hall_id,
      },
      "[fase-4] opprettet scheduled-game-rad fra plan-run + catalog",
    );

    return {
      scheduledGameId: newId,
      catalogEntry: catalog,
      reused: false,
    };
  }

  /**
   * Plukk en hall-gruppe for hallen. Engine krever group_hall_id, men
   * single-hall katalog-runs har ikke en eksplisitt gruppe. Vi velger
   * første aktive medlemskap, eller fallback til en eksisterende gruppe
   * som inneholder hallen.
   */
  private async resolveGroupHallId(hallId: string): Promise<string> {
    const { rows } = await this.pool.query<{ group_id: string }>(
      `SELECT group_id
       FROM "${this.schema}"."app_hall_group_members" m
       INNER JOIN "${this.schema}"."app_hall_groups" g ON g.id = m.group_id
       WHERE m.hall_id = $1
         AND g.deleted_at IS NULL
         AND g.status = 'active'
       ORDER BY m.added_at ASC
       LIMIT 1`,
      [hallId],
    );
    if (rows[0]) return rows[0].group_id;
    // Ingen aktiv gruppe-medlemskap — engine vil feile på FK-violation.
    // Vi kaster en eksplisitt feil med klart UX-budskap.
    throw new DomainError(
      "HALL_NOT_IN_GROUP",
      `Hallen ${hallId} er ikke medlem av en aktiv hall-gruppe. Catalog-modellen krever at hallen tilhører minst én gruppe for å starte spill.`,
    );
  }

  private dateRowToKey(value: unknown): string {
    if (typeof value === "string") {
      return value.length >= 10 ? value.slice(0, 10) : value;
    }
    if (value instanceof Date) {
      const yyyy = value.getUTCFullYear();
      const mm = String(value.getUTCMonth() + 1).padStart(2, "0");
      const dd = String(value.getUTCDate()).padStart(2, "0");
      return `${yyyy}-${mm}-${dd}`;
    }
    return "0000-00-00";
  }
}
