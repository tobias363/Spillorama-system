/**
 * Fase 3 (2026-05-07): admin-web API-adapter for agent-game-plan-runtime.
 *
 * Backend-router: apps/backend/src/routes/agentGamePlan.ts
 *   GET  /api/agent/game-plan/current
 *   POST /api/agent/game-plan/start
 *   POST /api/agent/game-plan/advance
 *   POST /api/agent/game-plan/jackpot-setup
 *   POST /api/agent/game-plan/pause
 *   POST /api/agent/game-plan/resume
 *
 * Permissions: GAME1_MASTER_WRITE (samme som master-konsollet og
 * `agent-game1`-API-en). Master-only writes håndheves bak i ruteren via
 * plan.hallId-match mot actor.hallId.
 *
 * Feature-flag: caller (Spill1HallStatusBox / NextGamePanel) velger om
 * dette API-et brukes eller om man faller tilbake til legacy
 * `agent-game1.ts`. Begge eksisterer side om side i Fase 3.
 */

import { apiRequest } from "./client.js";
import type {
  GameCatalogEntry,
  TicketColor,
} from "./admin-game-catalog.js";
import type { GamePlan } from "./admin-game-plans.js";

// ── Typer ───────────────────────────────────────────────────────────────

export type GamePlanRunStatus = "idle" | "running" | "paused" | "finished";

export interface JackpotOverride {
  draw: number;
  prizesCents: Partial<Record<TicketColor, number>>;
}

export interface GamePlanRun {
  id: string;
  planId: string;
  hallId: string;
  /** "YYYY-MM-DD" Oslo-tz. */
  businessDate: string;
  currentPosition: number;
  status: GamePlanRunStatus;
  jackpotOverrides: Record<string, JackpotOverride>;
  startedAt: string | null;
  finishedAt: string | null;
  masterUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AgentGamePlanItem {
  id: string;
  position: number;
  notes: string | null;
  catalogEntry: GameCatalogEntry;
}

/**
 * Plan-snapshot trimmet til feltene master-UI trenger. Frontend mottar
 * IKKE createdAt/updatedAt/createdByUserId for plan i runtime-responsen
 * — disse er admin-only og ikke relevant for cash-inout.
 */
export interface AgentGamePlanSnapshot {
  id: string;
  name: string;
  description: string | null;
  hallId: string | null;
  groupOfHallsId: string | null;
  weekdays: GamePlan["weekdays"];
  startTime: string;
  endTime: string;
  isActive: boolean;
}

export interface AgentGamePlanCurrentResponse {
  hallId: string;
  /** "YYYY-MM-DD" Oslo-tz. */
  businessDate: string;
  run: GamePlanRun | null;
  plan: AgentGamePlanSnapshot | null;
  items: AgentGamePlanItem[];
  currentItem: AgentGamePlanItem | null;
  nextItem: AgentGamePlanItem | null;
  jackpotSetupRequired: boolean;
  pendingJackpotOverride: {
    draw: number;
    prizesCents: Partial<Record<TicketColor, number>>;
  } | null;
  isMaster: boolean;
}

/**
 * Fase 4 (2026-05-07): /start og /advance returnerer `scheduledGameId` +
 * `bridgeError` når engine-bridge er injisert i routeren. `scheduledGameId`
 * er IDen til den nye `app_game1_scheduled_games`-raden. Denne legacy-
 * adapteren er historisk: kanonisk master-flyt går nå via
 * `/api/agent/game1/master/start`, der fresh plan-runtime-rad åpnes som
 * `purchase_open` og engine-start krever neste master-start.
 *
 * `bridgeError` er en kort feilkode (eks `BRIDGE_FAILED`,
 * `GAME_PLAN_RUN_CORRUPT`) når bridgen feilet på en måte som IKKE
 * blokkerer plan-state-overgangen — frontend kan logge og velge å falle
 * tilbake til legacy-flyt. `JACKPOT_SETUP_REQUIRED` og `HALL_NOT_IN_GROUP`
 * propageres som vanlige domain-errors, ikke i `bridgeError`.
 */
export interface AgentGamePlanStartResponse {
  run: GamePlanRun;
  scheduledGameId: string | null;
  bridgeError: string | null;
}

export interface AgentGamePlanAdvanceResponse {
  run: GamePlanRun;
  nextGame: GameCatalogEntry | null;
  jackpotSetupRequired: boolean;
  scheduledGameId: string | null;
  bridgeError: string | null;
}

// ── GET /current ────────────────────────────────────────────────────────

/**
 * @deprecated Bølge 3 (2026-05-08): bruk `fetchLobbyState` fra
 * `./agent-game1.js` i stedet. Aggregator (Bølge 1) returnerer ÉN ferdig
 * konsistent shape med kanonisk `currentScheduledGameId` og full GoH-
 * ready-state — ingen dual-fetch eller merge-logikk i klient. Denne
 * funksjonen holdes for kompatibilitet inntil siste caller (per
 * 2026-05-08 ingen) er migrert.
 *
 * Audit: `docs/architecture/PLAN_SPILL_KOBLING_FUNDAMENT_AUDIT_2026-05-08.md` §6.3.
 */
export async function fetchAgentGamePlanCurrent(
  opts: { signal?: AbortSignal; hallId?: string } = {},
): Promise<AgentGamePlanCurrentResponse> {
  const qs = opts.hallId ? `?hallId=${encodeURIComponent(opts.hallId)}` : "";
  return apiRequest<AgentGamePlanCurrentResponse>(
    `/api/agent/game-plan/current${qs}`,
    { auth: true, ...(opts.signal ? { signal: opts.signal } : {}) },
  );
}

// ── POST /start ─────────────────────────────────────────────────────────

/**
 * @deprecated Bølge 3 (2026-05-08): bruk `startMaster` fra
 * `./agent-game1.js` i stedet. Den nye master-routen (`POST /api/agent/
 * game1/master/start`) koordinerer plan-state + engine-bridge sentralt
 * via `MasterActionService` (Bølge 2) og returnerer `MasterActionResult`
 * med kanonisk `scheduledGameId`. Denne funksjonen treffer kun plan-
 * state og krever at engine-bridge spawnes separat — det er band-aid'en
 * Bølge 3 fjerner.
 */
export async function startAgentGamePlan(): Promise<AgentGamePlanStartResponse> {
  return apiRequest<AgentGamePlanStartResponse>(
    "/api/agent/game-plan/start",
    { method: "POST", auth: true, body: {} },
  );
}

// ── POST /advance ───────────────────────────────────────────────────────

/**
 * @deprecated Bølge 3 (2026-05-08): bruk `advanceMaster` fra
 * `./agent-game1.js`. Single master-route håndterer både plan-advance
 * og engine-bridge-spawn for ny posisjon i én atomisk operasjon.
 */
export async function advanceAgentGamePlan(): Promise<AgentGamePlanAdvanceResponse> {
  return apiRequest<AgentGamePlanAdvanceResponse>(
    "/api/agent/game-plan/advance",
    { method: "POST", auth: true, body: {} },
  );
}

// ── POST /jackpot-setup ─────────────────────────────────────────────────

export interface JackpotSetupInput {
  position: number;
  draw: number;
  /** Beløp i ØRE per bongfarge. Frontend må konvertere kr → øre. */
  prizesCents: Partial<Record<TicketColor, number>>;
}

/**
 * Submit jackpot-popup-override for én plan-posisjon. Brukes fortsatt
 * av `JackpotSetupModal.ts` per Bølge 3.5-oppfølger (migrasjon til
 * `setJackpot` fra `./agent-game1.js` planlegges i egen PR — ny
 * master-route krever `hallId` + `position` + `draw` + `prizesCents`).
 *
 * MERK: ingen `@deprecated`-tag her fordi denne fortsatt har aktiv
 * caller. Andre eksporter i denne filen er deprecated og bør ikke brukes
 * i ny kode.
 */
export async function setAgentGamePlanJackpot(
  input: JackpotSetupInput,
): Promise<{ run: GamePlanRun }> {
  return apiRequest<{ run: GamePlanRun }>(
    "/api/agent/game-plan/jackpot-setup",
    { method: "POST", auth: true, body: input },
  );
}

// ── POST /pause + /resume ───────────────────────────────────────────────

/**
 * @deprecated Bølge 3 (2026-05-08): bruk `pauseMaster` fra
 * `./agent-game1.js`. Single master-route koordinerer plan-state + engine
 * pause-tick via `MasterActionService` så plan og engine alltid holder
 * samme status (forrige dual-call hadde race der plan ble paused men
 * engine fortsatte).
 */
export async function pauseAgentGamePlan(): Promise<{ run: GamePlanRun }> {
  return apiRequest<{ run: GamePlanRun }>(
    "/api/agent/game-plan/pause",
    { method: "POST", auth: true, body: {} },
  );
}

/**
 * @deprecated Bølge 3 (2026-05-08): bruk `resumeMaster` fra
 * `./agent-game1.js`. Samme begrunnelse som `pauseAgentGamePlan` —
 * single master-route eliminerer plan↔engine-state-skew.
 */
export async function resumeAgentGamePlan(): Promise<{ run: GamePlanRun }> {
  return apiRequest<{ run: GamePlanRun }>(
    "/api/agent/game-plan/resume",
    { method: "POST", auth: true, body: {} },
  );
}
