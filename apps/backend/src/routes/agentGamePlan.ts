/**
 * Fase 3 (2026-05-07): agent-router for spilleplan-runtime.
 *
 * Eksponerer GamePlanRunService til master-dashboardet (cash-inout +
 * agent-portal) bak en feature-flag-aware data-source. Master-UI lytter
 * på `/api/agent/game-plan/current` for nåværende posisjon, jackpot-
 * setup-flagg og hele plan-sekvensen — og bruker `/start` + `/advance` +
 * `/jackpot-setup` til å drive runtime-state framover.
 *
 * Endepunkter:
 *   GET  /api/agent/game-plan/current
 *     Returnerer plan + items + currentItem + nextItem + jackpot-flagg.
 *     Lazy-oppretter dagens plan-run (idle-state) hvis en aktiv plan
 *     dekker (hall, ukedag) men ingen run finnes ennå — slik at master
 *     ser dagens kommende spill umiddelbart uten å trykke /start først
 *     (UI har ikke en knapp før det er en run å vise). Hvis ingen plan
 *     dekker → run=null + plan=null (ikke en feil — frontend faller
 *     tilbake til legacy-flow).
 *   POST /api/agent/game-plan/start
 *     Master-only. idle → running, current_position=1.
 *   POST /api/agent/game-plan/advance
 *     Master-only. Inkrementer current_position, eller signaler
 *     jackpotSetupRequired hvis nåværende spill krever popup.
 *   POST /api/agent/game-plan/jackpot-setup
 *     Master-only. Lagre override (draw + prizesCents) før advance.
 *   POST /api/agent/game-plan/pause
 *   POST /api/agent/game-plan/resume
 *     Master-only. Pause/resume status-overganger (mest for parity med
 *     master-UI; faktisk pause-knapp er fortsatt /api/agent/game1/pause).
 *
 * Rolle-krav:
 *   GAME1_MASTER_WRITE (ADMIN + HALL_OPERATOR + AGENT). SUPPORT er
 *   utelatt — samme som agentGame1.ts. Hall-scope håndheves ved at
 *   GET kun returnerer data for agentens egen hall, og POST avslår
 *   når caller ikke er master-hallens agent (plan.hallId === actor.hallId
 *   eller plan.groupOfHallsId.master === actor.hallId).
 *
 * Audit: writes går via GamePlanRunService som allerede skriver
 *   `game_plan_run.{create,start,advance,jackpot_set,pause,resume,finish}`.
 *
 * Feature-flag: routeren er alltid registrert. Frontend velger om den
 *   skal bruke `/api/agent/game1/current-game` (legacy) eller
 *   `/api/agent/game-plan/current` (ny) basert på `useNewGamePlan`-flagg
 *   i localStorage / config.
 */

import express from "express";
import { DomainError } from "../errors/DomainError.js";
import type {
  PlatformService,
  PublicAppUser,
} from "../platform/PlatformService.js";
import type { GamePlanRunService } from "../game/GamePlanRunService.js";
import type { GamePlanService } from "../game/GamePlanService.js";
import type {
  GamePlanItem,
  GamePlanRun,
  GamePlanWithItems,
} from "../game/gamePlan.types.js";
import type {
  GameCatalogEntry,
  TicketColor,
} from "../game/gameCatalog.types.js";
import { TICKET_COLOR_VALUES } from "../game/gameCatalog.types.js";
import type { GamePlanEngineBridge } from "../game/GamePlanEngineBridge.js";
import {
  assertAdminPermission,
  type AdminPermission,
} from "../platform/AdminAccessPolicy.js";
import {
  apiSuccess,
  apiFailure,
  getAccessTokenFromRequest,
  isRecordObject,
} from "../util/httpHelpers.js";
import { todayOsloKey } from "../util/osloTimezone.js";
import { logger as rootLogger } from "../util/logger.js";

const logger = rootLogger.child({ module: "agent-game-plan" });

const VALID_TICKET_COLORS = new Set<TicketColor>(TICKET_COLOR_VALUES);

export interface AgentGamePlanRouterDeps {
  platformService: PlatformService;
  planRunService: GamePlanRunService;
  planService: GamePlanService;
  /**
   * Fase 4 (2026-05-07): valgfri engine-bridge. Når satt, returnerer
   * `/start` og `/advance` en `scheduledGameId` som master-UI kan sende
   * til `/api/agent/game1/start` for å kjøre engine. Når null, beholder
   * vi Fase 3-oppførsel (kun state-overgang, ingen scheduled-game).
   */
  engineBridge?: GamePlanEngineBridge | null;
  /**
   * R1 (BIN-822, 2026-05-08): valgfri lobby-broadcaster. Når satt, kalles
   * `broadcastForHall(hallId)` etter hver vellykket master-handling
   * (start/advance/pause/resume) så klient som er subscribed til
   * `spill1:lobby:{hallId}`-rom mottar `lobby:state-update` umiddelbart.
   * Best-effort — broadcast-feil blokkerer ikke state-overgangen.
   */
  lobbyBroadcaster?: {
    broadcastForHall(hallId: string): Promise<void>;
  } | null;
}

interface PlanItemWithCatalog extends GamePlanItem {
  catalogEntry: GameCatalogEntry;
}

/**
 * Resolve hall-scope identisk med agentGame1.ts:
 *   - ADMIN → query.hallId override eller user.hallId
 *   - HALL_OPERATOR/AGENT → låst til user.hallId (cross-hall query avslås)
 */
function resolveHallScope(
  user: PublicAppUser,
  queryHallId: string | undefined,
): string {
  if (user.role === "ADMIN") {
    if (queryHallId && queryHallId.trim().length > 0) {
      return queryHallId.trim();
    }
    if (user.hallId) return user.hallId;
    throw new DomainError(
      "INVALID_INPUT",
      "ADMIN må angi ?hallId for plan-scope (egen hallId ikke satt).",
    );
  }
  if (user.role === "HALL_OPERATOR" || user.role === "AGENT") {
    if (!user.hallId) {
      throw new DomainError(
        "FORBIDDEN",
        "Din bruker er ikke tildelt en hall — kontakt admin.",
      );
    }
    if (
      queryHallId &&
      queryHallId.trim().length > 0 &&
      queryHallId.trim() !== user.hallId
    ) {
      throw new DomainError(
        "FORBIDDEN",
        "Du kan kun lese plan for din egen hall.",
      );
    }
    return user.hallId;
  }
  throw new DomainError(
    "FORBIDDEN",
    "Rollen din har ikke tilgang til spilleplan-runtime.",
  );
}

/**
 * Bestem om caller er master for runden. Master = agentens hall matcher
 * `run.hallId`.
 *
 * Pilot-fix 2026-05-08 (oppfølger #1011): tidligere brukte denne
 * `plan.hallId` for å bestemme master, noe som returnerte `false` for
 * GoH-bundne planer (`plan.hallId === null`) og blokkerte AGENT/
 * HALL_OPERATOR fra master-handlinger. Det medførte at kun ADMIN-
 * brukere kunne trykke Start på Tobias' pilot-plan.
 *
 * Fix-en er enkel og semantisk korrekt: `run.hallId` ER master-hallen.
 * `GamePlanRunService.getOrCreateForToday(hall)` setter
 * `run.hall_id = hall` (UNIQUE-constraint per (hall_id, business_date)),
 * og `GamePlanEngineBridge.createScheduledGameForPlanRunPosition` setter
 * `app_game1_scheduled_games.master_hall_id = run.hall_id`. Master-
 * begrepet er altså bundet til runden, ikke til planen.
 *
 * Konsekvenser per binding-type:
 *   - Direct-bundet plan (plan.hallId !== null): kun den hallen kan
 *     `getOrCreateForToday` (alle andre faller på NO_MATCHING_PLAN i
 *     plan-list-filteret), så run.hallId === plan.hallId. Backward-
 *     kompatibel oppførsel — eksisterende master-tester forblir grønne.
 *   - GoH-bundet plan (plan.hallId === null, plan.groupOfHallsId !== null):
 *     hver hall i GoH kan kalle `getOrCreateForToday` og får sin egen
 *     run (UNIQUE per (hall, businessDate)). Innenfor en run er det den
 *     callende hallen som er master.
 *   - ADMIN: alltid master.
 *
 * Cross-hall-beskyttelse beholdes via `resolveHallScope`: AGENT/
 * HALL_OPERATOR kan kun lese/skrive til egen `actor.hallId`, så de kan
 * aldri ende opp med en run hvor `run.hallId !== actor.hallId` med
 * mindre noen har manuelt seeded en run for andre haller (test-fixture).
 * I så fall vil `isMaster` returnere `false` og write-rutene avslår med
 * FORBIDDEN — riktig oppførsel.
 */
function isMaster(actor: PublicAppUser, run: GamePlanRun): boolean {
  if (actor.role === "ADMIN") return true;
  if (!actor.hallId) return false;
  return actor.hallId === run.hallId;
}

/**
 * Map plan-item + catalog-entry til wire-format. Frontend trenger nok
 * data til å rendre Spill1HallStatusBox + JackpotSetupModal uten ekstra
 * round-trips.
 */
function serializeItem(item: PlanItemWithCatalog): {
  id: string;
  position: number;
  notes: string | null;
  catalogEntry: GameCatalogEntry;
} {
  return {
    id: item.id,
    position: item.position,
    notes: item.notes,
    catalogEntry: item.catalogEntry,
  };
}

/**
 * Beregn jackpot-setup-flagget for nåværende posisjon. True hvis:
 *   - currentItem.catalogEntry.requiresJackpotSetup === true
 *   - run.jackpotOverrides[String(currentPosition)] mangler
 */
function computeJackpotSetupRequired(
  run: GamePlanRun,
  currentItem: PlanItemWithCatalog | null,
): boolean {
  if (!currentItem) return false;
  if (!currentItem.catalogEntry.requiresJackpotSetup) return false;
  const key = String(currentItem.position);
  return !Object.prototype.hasOwnProperty.call(run.jackpotOverrides, key);
}

/**
 * Plukk pending override for nåværende posisjon (hvis lagret). Frontend
 * pre-fyller jackpot-popup hvis admin har satt override tidligere.
 */
function pickPendingOverride(
  run: GamePlanRun,
  currentItem: PlanItemWithCatalog | null,
): { draw: number; prizesCents: Partial<Record<TicketColor, number>> } | null {
  if (!currentItem) return null;
  const key = String(currentItem.position);
  const override = run.jackpotOverrides[key];
  if (!override) return null;
  return { draw: override.draw, prizesCents: override.prizesCents };
}

export function createAgentGamePlanRouter(
  deps: AgentGamePlanRouterDeps,
): express.Router {
  const { platformService, planRunService, planService } = deps;
  const engineBridge = deps.engineBridge ?? null;
  const lobbyBroadcaster = deps.lobbyBroadcaster ?? null;
  const router = express.Router();

  /**
   * R1 (BIN-822): best-effort fire-and-forget lobby-broadcast. Brukes etter
   * vellykkede state-overganger så klient som er subscribed til
   * `spill1:lobby:{hallId}`-rom mottar fersk state. Aldri kaster — feil
   * logges av broadcasteren selv.
   */
  function fireLobbyBroadcast(hallId: string | null | undefined): void {
    if (!lobbyBroadcaster || typeof hallId !== "string" || !hallId.trim()) {
      return;
    }
    void lobbyBroadcaster.broadcastForHall(hallId.trim());
  }

  async function requirePermission(
    req: express.Request,
    permission: AdminPermission,
  ): Promise<PublicAppUser> {
    const accessToken = getAccessTokenFromRequest(req);
    const user = await platformService.getUserFromAccessToken(accessToken);
    assertAdminPermission(user, permission);
    return user;
  }

  /**
   * Slå opp aktiv run for (hall, businessDate). Hvis ingen run finnes,
   * lazy-opprett en idle-rad ved å kalle `getOrCreateForToday` — så
   * lenge `lazyCreate=true` (default). Det gjør at master-UI ser
   * dagens kommende spill umiddelbart når siden åpnes, uten å kreve at
   * en agent først trykker `/start` (som UI ikke har en knapp for før
   * det er en run å vise).
   *
   * Lazy-create kjøres KUN herfra (`GET /current`) — alle write-ruter
   * (`/start`, `/advance`, etc.) sender `lazyCreate=false` så de
   * fortsatt feiler eksplisitt med GAME_PLAN_RUN_NOT_FOUND når en run
   * mangler. Dette gir sterk separasjon mellom "vis dagens plan" og
   * "kjør state-overgang".
   *
   * Soft-fail-koder:
   *   - `NO_MATCHING_PLAN`        → ingen aktiv plan dekker (hall, ukedag),
   *                                 f.eks. master åpner siden lørdag når
   *                                 plan kun kjører mandag-fredag.
   *   - `HALL_NOT_IN_GROUP`       → hallen ikke konfigurert for plan-runtime.
   *   - `INVALID_INPUT` på past-date → defensivt; bør ikke skje ettersom
   *                                 vi sender `todayOsloKey()`.
   *
   * Andre feil (DB-feil, FK-violations, INVALID_CONFIG) propagerer.
   */
  async function loadCurrent(
    hallId: string,
    businessDate: string,
    lazyCreate: boolean = true,
  ): Promise<{
    run: GamePlanRun;
    plan: GamePlanWithItems;
  } | null> {
    let run = await planRunService.findForDay(hallId, businessDate);
    if (!run && lazyCreate) {
      try {
        run = await planRunService.getOrCreateForToday(hallId, businessDate);
      } catch (err) {
        if (
          err instanceof DomainError &&
          (err.code === "NO_MATCHING_PLAN" ||
            err.code === "HALL_NOT_IN_GROUP")
        ) {
          // Ingen plan dekker dagen — UI viser empty-state. Logges som
          // debug for diagnostikk uten å støye varsel-kanalen.
          logger.debug(
            { hallId, businessDate, code: err.code },
            "[fase-3] lazy-create avslått — ingen plan dekker dagen",
          );
          return null;
        }
        throw err;
      }
    }
    if (!run) return null;
    const plan = await planService.getById(run.planId);
    if (!plan) {
      // Plan slettet etter run ble opprettet — defensivt fall tilbake.
      logger.warn(
        { runId: run.id, planId: run.planId, hallId },
        "[fase-3] plan slettet for aktiv run — returnerer null",
      );
      return null;
    }
    return { run, plan };
  }

  // ── GET /api/agent/game-plan/current ───────────────────────────────────

  router.get("/api/agent/game-plan/current", async (req, res) => {
    try {
      const actor = await requirePermission(req, "GAME1_MASTER_WRITE");
      const queryHallId =
        typeof req.query.hallId === "string" ? req.query.hallId : undefined;
      // Pilot-fix 2026-05-08: ADMIN uten session-hall som ikke har sendt
      // `?hallId` fikk 400 INVALID_INPUT på en read-only poll. UI-siden
      // (`Spill1HallStatusBox.refresh`) poller dette endpointet hvert 10s
      // og 400-fail støyte til Sentry. Vi soft-failer her med et
      // empty-state svar — admin-UI har ingen plan-scope uten hallId, så
      // tomt svar er semantisk korrekt. Skrive-rutene (`/start` osv.)
      // bruker fortsatt den strikte resolveren og feiler 400 hvis admin
      // ikke har valgt hall.
      let hallId: string;
      try {
        hallId = resolveHallScope(actor, queryHallId);
      } catch (err) {
        if (
          err instanceof DomainError &&
          err.code === "INVALID_INPUT" &&
          actor.role === "ADMIN" &&
          !actor.hallId &&
          !queryHallId
        ) {
          apiSuccess(res, {
            hallId: null,
            businessDate: todayOsloKey(),
            run: null,
            plan: null,
            items: [],
            currentItem: null,
            nextItem: null,
            jackpotSetupRequired: false,
            pendingJackpotOverride: null,
            isMaster: false,
          });
          return;
        }
        throw err;
      }
      const businessDate = todayOsloKey();

      const loaded = await loadCurrent(hallId, businessDate);
      if (!loaded) {
        apiSuccess(res, {
          hallId,
          businessDate,
          run: null,
          plan: null,
          items: [],
          currentItem: null,
          nextItem: null,
          jackpotSetupRequired: false,
          pendingJackpotOverride: null,
          isMaster: false,
        });
        return;
      }
      const { run, plan } = loaded;
      const items = plan.items;
      const currentItem =
        items.find((i) => i.position === run.currentPosition) ?? null;
      const nextItem =
        items.find((i) => i.position === run.currentPosition + 1) ?? null;
      const jackpotSetupRequired = computeJackpotSetupRequired(
        run,
        currentItem,
      );
      const pendingJackpotOverride = pickPendingOverride(run, currentItem);
      const master = isMaster(actor, run);

      apiSuccess(res, {
        hallId,
        businessDate,
        run,
        plan: {
          id: plan.id,
          name: plan.name,
          description: plan.description,
          hallId: plan.hallId,
          groupOfHallsId: plan.groupOfHallsId,
          weekdays: plan.weekdays,
          startTime: plan.startTime,
          endTime: plan.endTime,
          isActive: plan.isActive,
        },
        items: items.map(serializeItem),
        currentItem: currentItem ? serializeItem(currentItem) : null,
        nextItem: nextItem ? serializeItem(nextItem) : null,
        jackpotSetupRequired,
        pendingJackpotOverride,
        isMaster: master,
      });
    } catch (err) {
      apiFailure(res, err);
    }
  });

  // ── POST /api/agent/game-plan/start ────────────────────────────────────

  router.post("/api/agent/game-plan/start", async (req, res) => {
    try {
      const actor = await requirePermission(req, "GAME1_MASTER_WRITE");
      const hallId = resolveHallScope(actor, undefined);
      const businessDate = todayOsloKey();

      // getOrCreateForToday sikrer at en run finnes for dagen. Hvis
      // ingen plan dekker (hall, ukedag) kastes NO_MATCHING_PLAN.
      const run = await planRunService.getOrCreateForToday(hallId, businessDate);
      const plan = await planService.getById(run.planId);
      if (!plan) {
        throw new DomainError(
          "GAME_PLAN_NOT_FOUND",
          "Plan finnes ikke for run.",
        );
      }
      if (!isMaster(actor, run)) {
        throw new DomainError(
          "FORBIDDEN",
          "Kun master-hallens agent kan starte spilleplan-runden.",
        );
      }

      const started = await planRunService.start(
        hallId,
        businessDate,
        actor.id,
      );

      // Fase 4 (2026-05-07): hvis engine-bridge er injisert, opprett en
      // `app_game1_scheduled_games`-rad for posisjon 1 så master-UI kan
      // kalle `/api/agent/game1/start` med `scheduledGameId` for å kjøre
      // engine. Bridgen er idempotent — re-trigger gir samme rad.
      let scheduledGameId: string | null = null;
      let bridgeError: string | null = null;
      if (engineBridge) {
        try {
          const result = await engineBridge.createScheduledGameForPlanRunPosition(
            started.id,
            started.currentPosition,
          );
          scheduledGameId = result.scheduledGameId;
        } catch (err) {
          // JACKPOT_SETUP_REQUIRED og HALL_NOT_IN_GROUP er forventede
          // domain-errors som UI kan vise — propager. Ukjente feil logges
          // og strippes fra responsen så start-flagget ikke blokkeres.
          if (err instanceof DomainError) {
            if (
              err.code === "JACKPOT_SETUP_REQUIRED" ||
              err.code === "HALL_NOT_IN_GROUP"
            ) {
              throw err;
            }
            bridgeError = err.code;
            logger.warn(
              { runId: started.id, position: started.currentPosition, err },
              "[fase-4] engine-bridge feilet — fortsetter uten scheduledGameId",
            );
          } else {
            bridgeError = "BRIDGE_FAILED";
            logger.error(
              { runId: started.id, position: started.currentPosition, err },
              "[fase-4] engine-bridge kastet uventet feil",
            );
          }
        }
      }

      // R1 (BIN-822): klient som er subscribed til `spill1:lobby:{hallId}`
      // får oppdatert state nå (state-overgang idle → running).
      fireLobbyBroadcast(hallId);

      apiSuccess(res, {
        run: started,
        scheduledGameId,
        bridgeError,
      });
    } catch (err) {
      apiFailure(res, err);
    }
  });

  // ── POST /api/agent/game-plan/advance ──────────────────────────────────

  router.post("/api/agent/game-plan/advance", async (req, res) => {
    try {
      const actor = await requirePermission(req, "GAME1_MASTER_WRITE");
      const hallId = resolveHallScope(actor, undefined);
      const businessDate = todayOsloKey();

      const loaded = await loadCurrent(hallId, businessDate, false);
      if (!loaded) {
        throw new DomainError(
          "GAME_PLAN_RUN_NOT_FOUND",
          "Ingen aktiv run for (hall, dato). Kall /start først.",
        );
      }
      const { run } = loaded;
      if (!isMaster(actor, run)) {
        throw new DomainError(
          "FORBIDDEN",
          "Kun master-hallens agent kan flytte spilleplanen videre.",
        );
      }

      const result = await planRunService.advanceToNext(
        hallId,
        businessDate,
        actor.id,
      );

      // Fase 4 (2026-05-07): opprett scheduled-game-rad for ny posisjon
      // hvis bridgen er injisert og vi faktisk gikk videre (ikke jackpot-
      // blokkering, ikke ferdig).
      let scheduledGameId: string | null = null;
      let bridgeError: string | null = null;
      if (
        engineBridge &&
        !result.jackpotSetupRequired &&
        result.run.status !== "finished" &&
        result.nextGame !== null
      ) {
        try {
          const bridgeResult =
            await engineBridge.createScheduledGameForPlanRunPosition(
              result.run.id,
              result.run.currentPosition,
            );
          scheduledGameId = bridgeResult.scheduledGameId;
        } catch (err) {
          if (err instanceof DomainError) {
            if (
              err.code === "JACKPOT_SETUP_REQUIRED" ||
              err.code === "HALL_NOT_IN_GROUP"
            ) {
              throw err;
            }
            bridgeError = err.code;
            logger.warn(
              {
                runId: result.run.id,
                position: result.run.currentPosition,
                err,
              },
              "[fase-4] engine-bridge feilet på advance — fortsetter uten scheduledGameId",
            );
          } else {
            bridgeError = "BRIDGE_FAILED";
            logger.error(
              {
                runId: result.run.id,
                position: result.run.currentPosition,
                err,
              },
              "[fase-4] engine-bridge kastet uventet feil ved advance",
            );
          }
        }
      }

      // R1 (BIN-822): klient bytter til ny posisjon eller "finished"-state.
      fireLobbyBroadcast(hallId);

      apiSuccess(res, {
        run: result.run,
        nextGame: result.nextGame,
        jackpotSetupRequired: result.jackpotSetupRequired,
        scheduledGameId,
        bridgeError,
      });
    } catch (err) {
      apiFailure(res, err);
    }
  });

  // ── POST /api/agent/game-plan/jackpot-setup ────────────────────────────

  router.post("/api/agent/game-plan/jackpot-setup", async (req, res) => {
    try {
      const actor = await requirePermission(req, "GAME1_MASTER_WRITE");
      const hallId = resolveHallScope(actor, undefined);
      const businessDate = todayOsloKey();

      if (!isRecordObject(req.body)) {
        throw new DomainError("INVALID_INPUT", "Payload må være et objekt.");
      }
      const body = req.body;
      const positionRaw = body.position;
      const position = Number(positionRaw);
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
      const drawRaw = body.draw;
      const draw = Number(drawRaw);
      // Hotfix 2 (2026-05-07): Spill 1 trekker maks 90 baller, så `draw`
      // ≥ 91 er garantert ugyldig. Service-laget fanger fortsatt dette
      // senere via catalog-validering, men validering her fanger feilen
      // før vi runtripper til DB. Tester på service-laget verifiserer at
      // også >90 fanges hvis admin har catalog med færre baller.
      if (
        !Number.isFinite(draw) ||
        !Number.isInteger(draw) ||
        draw < 1 ||
        draw > 90
      ) {
        throw new DomainError(
          "INVALID_INPUT",
          "draw må være heltall mellom 1 og 90.",
        );
      }
      if (
        !body.prizesCents ||
        typeof body.prizesCents !== "object" ||
        Array.isArray(body.prizesCents)
      ) {
        throw new DomainError(
          "INVALID_INPUT",
          "prizesCents må være et objekt.",
        );
      }
      // Whitelist-validering — service-laget repeterer dette mot
      // catalog-entry, men vi skiller "ugyldig farge i request" fra
      // "farge ikke tillatt for spillet" tidligst mulig for klart UX.
      const prizesCents: Record<string, number> = {};
      for (const [k, v] of Object.entries(
        body.prizesCents as Record<string, unknown>,
      )) {
        if (!VALID_TICKET_COLORS.has(k as TicketColor)) {
          throw new DomainError(
            "INVALID_INPUT",
            `prizesCents.${k} er ikke en gyldig bongfarge.`,
          );
        }
        const n = Number(v);
        if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
          throw new DomainError(
            "INVALID_INPUT",
            `prizesCents.${k} må være positivt heltall (øre).`,
          );
        }
        prizesCents[k] = n;
      }
      if (Object.keys(prizesCents).length === 0) {
        throw new DomainError(
          "INVALID_INPUT",
          "prizesCents må ha minst én farge.",
        );
      }

      const loaded = await loadCurrent(hallId, businessDate, false);
      if (!loaded) {
        throw new DomainError(
          "GAME_PLAN_RUN_NOT_FOUND",
          "Ingen aktiv run for (hall, dato).",
        );
      }
      const { run } = loaded;
      if (!isMaster(actor, run)) {
        throw new DomainError(
          "FORBIDDEN",
          "Kun master-hallens agent kan sette jackpot-override.",
        );
      }

      const updated = await planRunService.setJackpotOverride(
        hallId,
        businessDate,
        position,
        { draw, prizesCents },
        actor.id,
      );
      // R1 (BIN-822): jackpot-setup kan endre om engine-bridge spawner
      // scheduled-game; klient bør re-fetche state.
      fireLobbyBroadcast(hallId);
      apiSuccess(res, { run: updated });
    } catch (err) {
      apiFailure(res, err);
    }
  });

  // ── POST /api/agent/game-plan/pause ────────────────────────────────────

  router.post("/api/agent/game-plan/pause", async (req, res) => {
    try {
      const actor = await requirePermission(req, "GAME1_MASTER_WRITE");
      const hallId = resolveHallScope(actor, undefined);
      const businessDate = todayOsloKey();
      const loaded = await loadCurrent(hallId, businessDate, false);
      if (!loaded) {
        throw new DomainError(
          "GAME_PLAN_RUN_NOT_FOUND",
          "Ingen aktiv run for (hall, dato).",
        );
      }
      if (!isMaster(actor, loaded.run)) {
        throw new DomainError(
          "FORBIDDEN",
          "Kun master-hallens agent kan pause spilleplanen.",
        );
      }
      const run = await planRunService.pause(hallId, businessDate, actor.id);
      // R1 (BIN-822): klient ser pauset-state.
      fireLobbyBroadcast(hallId);
      apiSuccess(res, { run });
    } catch (err) {
      apiFailure(res, err);
    }
  });

  // ── POST /api/agent/game-plan/resume ───────────────────────────────────

  router.post("/api/agent/game-plan/resume", async (req, res) => {
    try {
      const actor = await requirePermission(req, "GAME1_MASTER_WRITE");
      const hallId = resolveHallScope(actor, undefined);
      const businessDate = todayOsloKey();
      const loaded = await loadCurrent(hallId, businessDate, false);
      if (!loaded) {
        throw new DomainError(
          "GAME_PLAN_RUN_NOT_FOUND",
          "Ingen aktiv run for (hall, dato).",
        );
      }
      if (!isMaster(actor, loaded.run)) {
        throw new DomainError(
          "FORBIDDEN",
          "Kun master-hallens agent kan resume spilleplanen.",
        );
      }
      const run = await planRunService.resume(hallId, businessDate, actor.id);
      // R1 (BIN-822): klient bytter fra paused tilbake til running.
      fireLobbyBroadcast(hallId);
      apiSuccess(res, { run });
    } catch (err) {
      apiFailure(res, err);
    }
  });

  return router;
}
