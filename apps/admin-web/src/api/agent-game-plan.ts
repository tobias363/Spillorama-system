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
 * er IDen til den nye `app_game1_scheduled_games`-raden som engine kan
 * starte fra (status='ready_to_start'). Frontend bruker denne for å
 * trigge legacy `/api/agent/game1/start` rett etter at planen er startet
 * — bridgen oppretter raden, legacy-routen finner den via hallId og
 * starter engine.
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

export async function startAgentGamePlan(): Promise<AgentGamePlanStartResponse> {
  return apiRequest<AgentGamePlanStartResponse>(
    "/api/agent/game-plan/start",
    { method: "POST", auth: true, body: {} },
  );
}

// ── POST /advance ───────────────────────────────────────────────────────

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

export async function setAgentGamePlanJackpot(
  input: JackpotSetupInput,
): Promise<{ run: GamePlanRun }> {
  return apiRequest<{ run: GamePlanRun }>(
    "/api/agent/game-plan/jackpot-setup",
    { method: "POST", auth: true, body: input },
  );
}

// ── POST /pause + /resume ───────────────────────────────────────────────

export async function pauseAgentGamePlan(): Promise<{ run: GamePlanRun }> {
  return apiRequest<{ run: GamePlanRun }>(
    "/api/agent/game-plan/pause",
    { method: "POST", auth: true, body: {} },
  );
}

export async function resumeAgentGamePlan(): Promise<{ run: GamePlanRun }> {
  return apiRequest<{ run: GamePlanRun }>(
    "/api/agent/game-plan/resume",
    { method: "POST", auth: true, body: {} },
  );
}
