/**
 * Task 1.4 (2026-04-24): admin-web API-adapter for unified agent-portal
 * Spill 1-control mot `scheduled_games`-paradigmet.
 *
 * Backend-router: apps/backend/src/routes/agentGame1.ts
 *   - GET  /api/agent/game1/current-game
 *   - GET  /api/agent/game1/hall-status
 *   - POST /api/agent/game1/start
 *   - POST /api/agent/game1/resume
 *
 * Permissions: GAME1_MASTER_WRITE (samme som master-konsollet). Agent-
 * router legger til hall-scope-sjekk: kun master-hall-agent kan POSTe
 * start/resume, mens GET-endepunkter er tilgjengelig for alle deltakende
 * haller slik at slave-agenter også kan rendre status-stripen.
 *
 * Bølge 3 (2026-05-08): kanonisk lobby-state + master-actions.
 *   - fetchLobbyState(hallId)  — single-source-of-truth via aggregator
 *   - startMaster / advanceMaster / pauseMaster / resumeMaster /
 *     stopMaster / setJackpot — alle treffer
 *     `/api/agent/game1/master/*` (Bølge 2 routes) som returnerer
 *     `MasterActionResult` med `scheduledGameId` (NULL for finished/bridge-
 *     failed) + `planRunId` + status. UI bruker KUN `scheduledGameId` for
 *     videre actions; `planRunId` er kun for diagnose/audit.
 *
 *   Backend-router: apps/backend/src/routes/agentGame1Lobby.ts +
 *                    apps/backend/src/routes/agentGame1Master.ts
 *
 *   Refaktor-detaljer i `docs/architecture/PLAN_SPILL_KOBLING_FUNDAMENT_AUDIT_2026-05-08.md` §6.3.
 */

// admin-web har ikke @spillorama/shared-types som workspace-dependency
// (samme mønster som admin-payments.ts) — derfor relativ path-import direkte
// fra source-filen. Schema-fila er pure-zod (ingen runtime-deps utover zod
// som er vendored gjennom shared-types).
import {
  Spill1AgentLobbyStateSchema,
  type Spill1AgentLobbyState,
  type Spill1LobbyInconsistencyCode,
  type Spill1PlanRunStatus,
  type Spill1ScheduledGameStatus,
} from "../../../../packages/shared-types/src/spill1-lobby-state.js";

import { apiRequest } from "./client.js";

export interface Spill1CurrentGameHall {
  hallId: string;
  hallName: string;
  isReady: boolean;
  readyAt: string | null;
  digitalTicketsSold: number;
  physicalTicketsSold: number;
  excludedFromGame: boolean;
  excludedReason: string | null;
}

export interface Spill1CurrentGame {
  id: string;
  status: string;
  masterHallId: string;
  groupHallId: string;
  participatingHallIds: string[];
  subGameName: string;
  customGameName: string | null;
  scheduledStartTime: string | null;
  scheduledEndTime: string | null;
  actualStartTime: string | null;
  actualEndTime: string | null;
}

export interface Spill1CurrentGameResponse {
  hallId: string;
  isMasterAgent: boolean;
  currentGame: Spill1CurrentGame | null;
  halls: Spill1CurrentGameHall[];
  allReady: boolean;
}

export interface Spill1HallStatusEntry {
  hallId: string;
  hallName: string;
  isReady: boolean;
  excludedFromGame: boolean;
  digitalTicketsSold: number;
  physicalTicketsSold: number;
}

export interface Spill1HallStatusResponse {
  hallId: string;
  gameId: string | null;
  halls: Spill1HallStatusEntry[];
  allReady: boolean;
}

export interface Spill1ActionResponse {
  gameId: string;
  status: string;
  actualStartTime?: string | null;
  auditId: string;
}

export async function fetchAgentGame1CurrentGame(
  opts: { signal?: AbortSignal } = {}
): Promise<Spill1CurrentGameResponse> {
  return apiRequest<Spill1CurrentGameResponse>(
    "/api/agent/game1/current-game",
    { auth: true, ...(opts.signal ? { signal: opts.signal } : {}) }
  );
}

export async function fetchAgentGame1HallStatus(): Promise<Spill1HallStatusResponse> {
  return apiRequest<Spill1HallStatusResponse>(
    "/api/agent/game1/hall-status",
    { auth: true }
  );
}

/**
 * REQ-007 (2026-04-26): start Spill 1 med valgfrie override-lister.
 *
 *   - `confirmExcludedHalls`: bekreft haller som allerede er ekskludert
 *     (admin/master har klikket "ekskluder" tidligere).
 *   - `confirmUnreadyHalls`: master overstyrer "agents not ready"-popup ved
 *     å eksplisitt bekrefte at disse hallene SKAL ekskluderes selv om de
 *     ikke har trykket klar. Backend skriver `start_game_with_unready_override`
 *     audit-event og setter excluded_from_game=true for hver hall i listen.
 */
export async function startAgentGame1(
  confirmExcludedHalls?: string[],
  confirmUnreadyHalls?: string[]
): Promise<Spill1ActionResponse> {
  const body: Record<string, unknown> = {};
  if (confirmExcludedHalls !== undefined) {
    body.confirmExcludedHalls = confirmExcludedHalls;
  }
  if (confirmUnreadyHalls !== undefined) {
    body.confirmUnreadyHalls = confirmUnreadyHalls;
  }
  return apiRequest<Spill1ActionResponse>(
    "/api/agent/game1/start",
    { method: "POST", auth: true, body }
  );
}

export async function resumeAgentGame1(): Promise<Spill1ActionResponse> {
  return apiRequest<Spill1ActionResponse>(
    "/api/agent/game1/resume",
    { method: "POST", auth: true, body: {} }
  );
}

/**
 * 2026-05-02 (Tobias UX-feedback): non-master agent kan markere egen hall
 * som klar. Backend-rute er admin-side (`/api/admin/game1/halls/:hallId/ready`)
 * men AGENT har `GAME1_HALL_READY_WRITE`-permission + hall-scope.
 */
export async function markHallReadyForGame(
  hallId: string,
  gameId: string | null,
  digitalTicketsSold?: number
): Promise<unknown> {
  // 2026-05-09 (Tobias-direktiv): gameId er nå OPTIONAL. Hvis null sendes,
  // backend lazy-spawner scheduled-game (status=scheduled) via
  // MasterActionService.prepareScheduledGame før mark-ready binder seg
  // til den nye gameId. Master starter spillet senere via separat
  // /master/start-route.
  const body: Record<string, unknown> = {};
  if (gameId !== null) {
    body.gameId = gameId;
  }
  if (typeof digitalTicketsSold === "number") {
    body.digitalTicketsSold = digitalTicketsSold;
  }
  return apiRequest<unknown>(
    `/api/admin/game1/halls/${encodeURIComponent(hallId)}/ready`,
    { method: "POST", auth: true, body }
  );
}

export async function unmarkHallReadyForGame(
  hallId: string,
  gameId: string | null
): Promise<unknown> {
  // 2026-05-13 (Tobias pilot-test fix #5): gameId er nå OPTIONAL. Hvis null
  // sendes (typisk fordi current scheduled-game er terminal), lazy-spawner
  // backend ny scheduled-game via samme flyt som markHallReadyForGame.
  // Tidligere bailet routen med GAME_ID_REQUIRED — som ga "ikke mulig å
  // angre klar i backend"-rapporten fra Tobias.
  const body: Record<string, unknown> = {};
  if (gameId !== null) {
    body.gameId = gameId;
  }
  return apiRequest<unknown>(
    `/api/admin/game1/halls/${encodeURIComponent(hallId)}/unready`,
    { method: "POST", auth: true, body }
  );
}
/**
 * 2026-05-02: bingovert markerer egen hall som "Ingen kunder" — hallen
 * ekskluderes fra runden. Master-konsollet ser hallen som rød. Agent
 * kan re-åpne via `setHallHasCustomersForGame`.
 *
 * Backend-rute: POST /api/admin/game1/halls/:hallId/no-customers
 * Permission:   GAME1_HALL_READY_WRITE + hall-scope (egen hall)
 */
export async function setHallNoCustomersForGame(
  hallId: string,
  gameId: string | null,
  reason?: string
): Promise<unknown> {
  // 2026-05-09 (Tobias-direktiv): gameId er nå OPTIONAL — samme lazy-spawn
  // som markHallReadyForGame. Bind no-customers til lazy-spawnet
  // scheduled-game (status=scheduled) hvis ingen aktiv finnes.
  const body: Record<string, unknown> = {};
  if (gameId !== null) {
    body.gameId = gameId;
  }
  if (reason && reason.trim()) {
    body.reason = reason.trim();
  }
  return apiRequest<unknown>(
    `/api/admin/game1/halls/${encodeURIComponent(hallId)}/no-customers`,
    { method: "POST", auth: true, body }
  );
}

/**
 * 2026-05-02: bingovert un-ekskluderer egen hall (angrer "Ingen kunder").
 *
 * Backend-rute: POST /api/admin/game1/halls/:hallId/has-customers
 */
export async function setHallHasCustomersForGame(
  hallId: string,
  gameId: string
): Promise<unknown> {
  return apiRequest<unknown>(
    `/api/admin/game1/halls/${encodeURIComponent(hallId)}/has-customers`,
    { method: "POST", auth: true, body: { gameId } }
  );
}

/**
 * 2026-05-02: master-agent stopper aktiv runde fra cash-inout-dashboardet.
 *
 * Backend-rute: POST /api/agent/game1/stop
 */
export async function stopAgentGame1(reason?: string): Promise<Spill1ActionResponse> {
  const body: Record<string, unknown> = {};
  if (reason && reason.trim()) {
    body.reason = reason.trim();
  }
  return apiRequest<Spill1ActionResponse>(
    "/api/agent/game1/stop",
    { method: "POST", auth: true, body }
  );
}

// ── Bølge 3 (2026-05-08): kanonisk lobby-state + master-actions ──────────

/**
 * Aggregert resultat for hver master-action. Ekvivalent med backend-
 * `MasterActionResult`-typen i `apps/backend/src/game/MasterActionService.ts`.
 *
 * UI skal kun bruke `scheduledGameId` for videre handlinger (start/pause/
 * resume/stop/setJackpot — id-en passes inn av master-routen). `planRunId`
 * er informativ og brukes til diagnose / audit-korrelasjon.
 */
export interface MasterActionResult {
  /**
   * Aktiv scheduled-game-id ETTER actionen. `null` ved `finish` eller hvis
   * bridgen feilet å spawne (kontroller `inconsistencyWarnings`).
   */
  scheduledGameId: string | null;
  /** Plan-run-id som handlingen ble utført mot. Aldri null. */
  planRunId: string;
  /** Plan-runtime-status etter handlingen. */
  status: Spill1PlanRunStatus;
  /** Scheduled-game-status etter handlingen. `null` hvis ingen scheduled-game ble berørt. */
  scheduledGameStatus: Spill1ScheduledGameStatus | null;
  /** Inconsistency-warnings fra aggregator-pre-check. Klient bør vise disse. */
  inconsistencyWarnings: Spill1LobbyInconsistencyCode[];
}

/**
 * Hent ferdig-aggregert lobby-state for hallen (Bølge 1 single-source-of-
 * truth). Erstatter den tidligere dual-fetch-pattern (`fetchAgentGamePlanCurrent`
 * + `fetchAgentGame1CurrentGame`) — én kall, én id-rom, ingen merge-band-aid.
 *
 * `hallId` kreves for HALL_OPERATOR/AGENT (cross-hall query → 403). ADMIN
 * kan utelate eller sende eksplisitt hallId.
 *
 * Responsen valideres mot Zod-skjemaet — runtime-validering fanger
 * version-skew mellom backend og frontend før UI rendrer på korrupte felter.
 */
export async function fetchLobbyState(
  hallId?: string,
  opts: { signal?: AbortSignal } = {}
): Promise<Spill1AgentLobbyState> {
  const path = hallId
    ? `/api/agent/game1/lobby?hallId=${encodeURIComponent(hallId)}`
    : "/api/agent/game1/lobby";
  const raw = await apiRequest<unknown>(path, {
    auth: true,
    ...(opts.signal ? { signal: opts.signal } : {}),
  });
  // Strict parse: kontrakt-brudd skal kaste, slik at caller fanger feilen
  // tidlig i stedet for å rendre på en partial payload med manglende felter.
  return Spill1AgentLobbyStateSchema.parse(raw);
}

interface MasterActionBody {
  hallId?: string;
  reason?: string;
  position?: number;
  draw?: number;
  prizesCents?: Record<string, number>;
}

/**
 * Felles HTTP-utgang for master-actions. Posten kalles med tom body når UI
 * lar backend bruke caller's user.hallId; ADMIN kan sende `hallId` i body.
 */
async function postMasterAction(
  path: string,
  body: MasterActionBody = {}
): Promise<MasterActionResult> {
  return apiRequest<MasterActionResult>(path, {
    method: "POST",
    auth: true,
    body,
  });
}

/**
 * Master styrer Spill 1 i to steg. Første kall på ny plan-posisjon åpner
 * `purchase_open` og returnerer uten engine-start; neste kall på samme
 * scheduled-game starter trekningen (`purchase_open`/`ready_to_start` → `running`).
 *
 * Backend kjører:
 *   1. `MasterActionService.start` (single sekvenseringsmotor)
 *   2. lobby-aggregator-pre-check + audit-event
 *   3. engine-bridge spawn eller gjenbruk av scheduled-game-rad
 *
 * Returnerer `scheduledGameId` som UI lagrer for videre actions (advance/
 * pause/resume/stop). DomainError-koder propageres som `ApiError` (typiske
 * koder: `JACKPOT_SETUP_REQUIRED`, `HALLS_NOT_READY`, `BRIDGE_FAILED`).
 *
 * ADR-0017 (2026-05-10): daglig-akkumulert jackpot-bekreftelse er fjernet.
 * Tobias-direktiv — bingoverten setter ALLTID jackpot manuelt før spillet
 * starter. Kun `JACKPOT_SETUP_REQUIRED` (catalog-entry pos 7) håndteres
 * fortsatt av UI-flyten.
 */
export async function startMaster(
  hallId?: string,
): Promise<MasterActionResult> {
  const body: MasterActionBody = {};
  if (hallId !== undefined) body.hallId = hallId;
  return postMasterAction("/api/agent/game1/master/start", body);
}

/**
 * Master flytter til neste plan-posisjon. Plan-run advance-er, og engine-
 * bridge spawner scheduled-game for ny posisjon hvis aktuelt. Hvis ny
 * posisjon krever jackpot-popup, kaster backend `JACKPOT_SETUP_REQUIRED`.
 */
export async function advanceMaster(hallId?: string): Promise<MasterActionResult> {
  const body: MasterActionBody = {};
  if (hallId !== undefined) body.hallId = hallId;
  return postMasterAction("/api/agent/game1/master/advance", body);
}

/**
 * Master pauser aktiv Spill 1-runde (`running` → `paused`). Engine pauses
 * draw-timeren. `reason` er valgfritt audit-trail-felt.
 */
export async function pauseMaster(
  hallId?: string,
  reason?: string
): Promise<MasterActionResult> {
  const body: MasterActionBody = {};
  if (hallId !== undefined) body.hallId = hallId;
  if (reason !== undefined && reason.trim().length > 0) {
    body.reason = reason.trim();
  }
  return postMasterAction("/api/agent/game1/master/pause", body);
}

/**
 * Master gjenopptar pauset runde (`paused` → `running`).
 */
export async function resumeMaster(hallId?: string): Promise<MasterActionResult> {
  const body: MasterActionBody = {};
  if (hallId !== undefined) body.hallId = hallId;
  return postMasterAction("/api/agent/game1/master/resume", body);
}

/**
 * Master stopper aktiv runde (regulatorisk avbrudd). `reason` er PÅKREVD
 * for compliance-sporbarhet; backend avviser med INVALID_INPUT hvis tom.
 */
export async function stopMaster(
  hallId: string | undefined,
  reason: string
): Promise<MasterActionResult> {
  const body: MasterActionBody = { reason };
  if (hallId !== undefined) body.hallId = hallId;
  return postMasterAction("/api/agent/game1/master/stop", body);
}

/**
 * Master submitter jackpot-popup (draw + prizesCents per bongfarge) for
 * en spesifikk plan-posisjon. `prizesCents`-keys må matche katalog-
 * whitelist (gul/hvit/lilla); validering skjer server-side.
 */
export async function setJackpot(
  hallId: string | undefined,
  position: number,
  draw: number,
  prizesCents: Record<string, number>
): Promise<MasterActionResult> {
  const body: MasterActionBody = { position, draw, prizesCents };
  if (hallId !== undefined) body.hallId = hallId;
  return postMasterAction("/api/agent/game1/master/jackpot-setup", body);
}

// ── 2026-05-09: stale-state recovery ─────────────────────────────────────
//
// Master-driven cleanup of STALE_PLAN_RUN/BRIDGE_FAILED state. The route
// bypasses the lobby-aggregator pre-validation (which would block on
// those exact warnings) so master can unblock without `psql`.
//
// Idempotent: invoking on a clean hall returns
// `{ planRuns: 0, scheduledGames: 0 }`. UI typically refreshes
// `fetchLobbyState` after a successful call to confirm the warnings
// disappeared.

export interface RecoverStaleClearedPlanRun {
  id: string;
  businessDate: string;
  status: string;
  currentPosition: number;
  planId: string;
}

export interface RecoverStaleClearedScheduledGame {
  id: string;
  status: string;
  scheduledStartTime: string;
  scheduledEndTime: string;
  subGameName: string;
  groupHallId: string;
}

export interface RecoverStaleResponse {
  ok: true;
  cleared: {
    planRuns: number;
    scheduledGames: number;
  };
  details: {
    recoveredAt: string;
    todayBusinessDate: string;
    clearedPlanRuns: RecoverStaleClearedPlanRun[];
    clearedScheduledGames: RecoverStaleClearedScheduledGame[];
  };
}

/**
 * Master kaller cleanup av stale plan-runs og stuck scheduled-games for
 * en hall. Bypasser lobby-aggregator pre-validation slik at master kan
 * rydde opp selv om `BLOCKING_WARNING_CODES` (BRIDGE_FAILED,
 * DUAL_SCHEDULED_GAMES) ellers blokkerer alle write-actions.
 *
 * Idempotent — kall flere ganger er trygt; andre kall på en ren hall
 * returnerer `{ planRuns: 0, scheduledGames: 0 }`.
 *
 * Vanlige feilkoder:
 *   - RECOVERY_NOT_CONFIGURED (503): backend mangler service-injection
 *   - FORBIDDEN (400): caller er ikke master eller mangler permission
 *   - INVALID_INPUT (400): ugyldig hallId
 */
export async function recoverStale(
  hallId?: string,
): Promise<RecoverStaleResponse> {
  const body: { hallId?: string } = {};
  if (hallId !== undefined) body.hallId = hallId;
  return apiRequest<RecoverStaleResponse>(
    "/api/agent/game1/master/recover-stale",
    {
      method: "POST",
      auth: true,
      body,
    },
  );
}

/**
 * ADR-0022 Lag 4: master:heartbeat-respons fra
 * `POST /api/agent/game1/master/heartbeat`. Brukes av
 * `Game1AutoResumePausedService` til å skille "master aktiv" fra "master
 * borte → auto-resume safe". UI emit hvert 30s så lenge master har
 * cash-inout-konsollet åpent.
 */
export interface MasterHeartbeatResponse {
  acceptedAt: string;
  planRunUpdated: boolean;
  /** Optional årsak-kode for soft-fail; UI ignorerer dette feltet. */
  reason?: string;
}

/**
 * Send master-heartbeat. Fail-soft: caller skal ikke retrye umiddelbart
 * ved feil — neste 30s-interval fanger det. Vi kaster IKKE her; returnerer
 * planRunUpdated=false hvis backend nektet eller nettverk svikter.
 */
export async function sendMasterHeartbeat(
  hallId?: string,
): Promise<MasterHeartbeatResponse> {
  const body: { hallId?: string } = {};
  if (hallId !== undefined) body.hallId = hallId;
  try {
    return await apiRequest<MasterHeartbeatResponse>(
      "/api/agent/game1/master/heartbeat",
      {
        method: "POST",
        auth: true,
        body,
      },
    );
  } catch {
    // Fail-soft: returner neutral response så caller (timer-loop) ikke
    // logger error per iterasjon.
    return {
      acceptedAt: new Date().toISOString(),
      planRunUpdated: false,
      reason: "NETWORK_ERROR",
    };
  }
}
